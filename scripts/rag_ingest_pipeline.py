"""
CrossX 生产级 RAG 数据清洗与批量入库流水线 (Production Pipeline)
============================================================
用法:
    pip install langchain langchain-openai pymilvus python-frontmatter tiktoken
    export OPENAI_API_KEY="sk-..."
    export MILVUS_URI="http://localhost:19530"   # 或腾讯云 VectorDB 地址
    python rag_ingest_pipeline.py

本脚本用于将 lib/knowledge/docs/ 下的所有 Markdown 知识库文档
清洗、切片后写入 Milvus 向量数据库。

关键特性:
  - 严格 YAML 元数据校验（拦截脏数据入库）
  - 基于 Markdown 标题层级的语义切片（保证每个 Q&A 完整入库）
  - 字符级兜底切片（防止超长答案截断）
  - RBAC 元数据绑定（audience: b2c/b2b 随 chunk 存入向量库）
  - 完整的日志记录（生产 Ops 必备）
"""

import os
import glob
import logging
import frontmatter
from langchain.text_splitter import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Milvus
from langchain.schema import Document

# ---------------------------------------------------------------------------
# 1. 配置日志记录 (Ops 必备)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("rag_ingestion.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)

# ---------------------------------------------------------------------------
# 2. 核心配置
# ---------------------------------------------------------------------------
DATA_DIR = os.path.join(os.path.dirname(__file__), "../lib/knowledge/docs")
MILVUS_URI = os.environ.get("MILVUS_URI", "http://localhost:19530")
COLLECTION_NAME = "crossx_knowledge_base"
EMBEDDING_MODEL = OpenAIEmbeddings(
    model="text-embedding-3-small",
    openai_api_key=os.environ.get("OPENAI_API_KEY"),
)

# Metadata schema — all required fields for RBAC and filtering
REQUIRED_METADATA_KEYS = ["doc_id", "category", "target_country", "audience"]
VALID_AUDIENCES = {"b2c", "b2b"}
VALID_CATEGORIES = {"visa", "payment", "transport", "culture", "b2b_protocol", "lifestyle", "accommodation", "emergency"}


# ---------------------------------------------------------------------------
# 3. 严格的数据清洗与校验规则 (Data Validation)
# ---------------------------------------------------------------------------
def validate_metadata(metadata: dict, file_path: str) -> bool:
    """
    校验 YAML 头信息是否符合 CrossX 黄金标准。
    不符合规范的文件直接拦截，不入库。
    """
    # 检查必填项
    for key in REQUIRED_METADATA_KEYS:
        if key not in metadata:
            logging.error(f"[拦截] 文件 {file_path} 缺失关键标签: '{key}'")
            return False

    # 校验 audience 枚举值
    audience = str(metadata.get("audience", "")).lower().strip()
    if audience not in VALID_AUDIENCES:
        logging.error(
            f"[拦截] 文件 {file_path} audience 值不合法: '{audience}'。"
            f"合法值为: {VALID_AUDIENCES}"
        )
        return False

    # 校验 category 枚举值 (警告但不拦截，允许自定义 category)
    category = str(metadata.get("category", "")).lower().strip()
    if category not in VALID_CATEGORIES:
        logging.warning(
            f"[警告] 文件 {file_path} category 值 '{category}' 不在标准集合中。"
            f"标准集合: {VALID_CATEGORIES}"
        )

    # B2B 文档必须有 clearance 字段
    if audience == "b2b" and "clearance" not in metadata:
        logging.warning(
            f"[警告] B2B 文件 {file_path} 缺少 'clearance' 字段，建议补充 clearance: high"
        )

    return True


# ---------------------------------------------------------------------------
# 4. 单文件处理与切片逻辑
# ---------------------------------------------------------------------------
def process_single_file(file_path: str) -> list:
    """
    处理单个 Markdown 文件：
    1. 解析 YAML frontmatter 和正文
    2. 校验元数据
    3. 基于标题层级的语义切片
    4. 字符级兜底切片
    5. 将全局元数据注入每个切片
    返回: List[Document]
    """
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            post = frontmatter.load(f)

        metadata = dict(post.metadata)
        content = post.content

        # 脏数据过滤：正文过短视为无效文件
        if len(content.strip()) < 50:
            logging.warning(f"[跳过] 文件 {file_path} 正文过短（不足50字符），跳过。")
            return []

        # 执行元数据强校验
        if not validate_metadata(metadata, file_path):
            return []

        # ── 语义级 Markdown 切片 ──────────────────────────────────────────
        # 识别 ## 和 ### 标题，把每个 Q&A 打包成完整的一个向量块。
        # 这是解决"答案被切烂"问题的核心。
        headers_to_split_on = [
            ("#", "Header_1"),
            ("##", "Header_2"),
            ("###", "Question"),  # ### 级别直接识别为问题节点
        ]
        markdown_splitter = MarkdownHeaderTextSplitter(
            headers_to_split_on=headers_to_split_on,
            strip_headers=False,  # 保留标题文本在 chunk 里，方便 LLM 理解上下文
        )
        md_header_splits = markdown_splitter.split_text(content)

        # ── 字符级兜底切片 ──────────────────────────────────────────────────
        # 防止某个答案写得太长超过上下文窗口，做一次字符级兜底。
        # 使用中文标点符号作为优先分割点。
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=800,
            chunk_overlap=100,
            separators=["\n\n", "\n", "。", "！", "？", "；", " ", ""],
        )
        final_splits = text_splitter.split_documents(md_header_splits)

        # ── 组装最终的 Document 对象并绑定全局元数据 ─────────────────────
        docs_to_insert = []
        for i, split in enumerate(final_splits):
            # 合并 Markdown 标题元数据（如 Question: xxx）和全局 YAML 元数据
            combined_metadata = {**metadata, **split.metadata}
            # 添加 chunk_index 方便调试
            combined_metadata["chunk_index"] = i
            combined_metadata["source_file"] = os.path.basename(file_path)

            docs_to_insert.append(
                Document(
                    page_content=split.page_content,
                    metadata=combined_metadata,
                )
            )

        logging.info(
            f"[成功] 文件 {os.path.basename(file_path)} 清洗完毕，"
            f"audience={metadata.get('audience')}, "
            f"生成 {len(docs_to_insert)} 个 Chunk。"
        )
        return docs_to_insert

    except Exception as e:
        logging.error(f"[异常] 处理文件 {file_path} 时发生错误: {str(e)}", exc_info=True)
        return []


# ---------------------------------------------------------------------------
# 5. 批量流水线执行
# ---------------------------------------------------------------------------
def run_ingestion_pipeline(drop_old: bool = False):
    """
    批量扫描 DATA_DIR 下所有 .md 文件，清洗后写入 Milvus。

    参数:
        drop_old: True = 清空旧集合后重建（用于全量重刷）
                  False = 追加模式（用于增量更新）
    """
    logging.info("=" * 60)
    logging.info("=== 开始执行 CrossX RAG 数据清洗与入库流水线 ===")
    logging.info(f"=== 数据目录: {DATA_DIR}")
    logging.info(f"=== 向量数据库: {MILVUS_URI} / {COLLECTION_NAME}")
    logging.info(f"=== 模式: {'全量重建' if drop_old else '增量追加'}")
    logging.info("=" * 60)

    # 获取目录下所有的 .md 文件（递归）
    md_files = glob.glob(os.path.join(DATA_DIR, "**/*.md"), recursive=True)
    if not md_files:
        logging.warning(f"目录 {DATA_DIR} 下未找到任何 Markdown 文件。")
        return

    logging.info(f"共发现 {len(md_files)} 个 Markdown 文件，开始逐一处理...")

    all_docs_to_insert = []
    skipped_count = 0

    for file_path in sorted(md_files):
        docs = process_single_file(file_path)
        if docs:
            all_docs_to_insert.extend(docs)
        else:
            skipped_count += 1

    if not all_docs_to_insert:
        logging.error("没有有效的数据可以入库，请检查日志报错信息。")
        return

    logging.info(f"所有文件处理完毕:")
    logging.info(f"  - 有效 Chunk 数量: {len(all_docs_to_insert)}")
    logging.info(f"  - 跳过/失败文件数: {skipped_count}")
    logging.info(f"准备写入向量数据库...")

    # 分 B2C / B2B 统计
    b2c_chunks = [d for d in all_docs_to_insert if d.metadata.get("audience") == "b2c"]
    b2b_chunks = [d for d in all_docs_to_insert if d.metadata.get("audience") == "b2b"]
    logging.info(f"  - B2C chunks: {len(b2c_chunks)}")
    logging.info(f"  - B2B chunks: {len(b2b_chunks)}")

    # 批量连接向量数据库并写入
    try:
        Milvus.from_documents(
            documents=all_docs_to_insert,
            embedding=EMBEDDING_MODEL,
            connection_args={"uri": MILVUS_URI},
            collection_name=COLLECTION_NAME,
            drop_old=drop_old,
        )
        logging.info("=" * 60)
        logging.info(f"=== 🎉 成功！{len(all_docs_to_insert)} 个 Chunk 已写入向量数据库 ===")
        logging.info("=" * 60)
    except Exception as e:
        logging.critical(f"写入数据库失败: {str(e)}", exc_info=True)


# ---------------------------------------------------------------------------
# 检索时必须加 RBAC 过滤条件（防止 B2C 用户查到 B2B 机密）
# ---------------------------------------------------------------------------
def retrieve_with_rbac(vector_db, query: str, audience: str, target_country: str = None, top_k: int = 3):
    """
    带 RBAC 权限隔离的标准检索函数。

    关键原则: 永远不允许 b2c 用户查到 b2b 内容。
    audience 参数必须由后端根据用户登录身份决定，不可由用户自己传入。

    示例用法:
        results = retrieve_with_rbac(vector_db, "how to use DiDi in China", "b2c", "China")
    """
    # 构建 Milvus 的 Metadata 过滤表达式
    filter_parts = [f'audience == "{audience}"']
    if target_country:
        filter_parts.append(f'target_country == "{target_country}"')
    filter_expr = " and ".join(filter_parts)

    logging.info(f"[检索] Query='{query[:50]}...', Filter='{filter_expr}'")

    results = vector_db.similarity_search(
        query=query,
        expr=filter_expr,  # 核心：RBAC 权限隔离就在这里生效！
        k=top_k,
    )
    return results


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="CrossX RAG 数据入库流水线")
    parser.add_argument(
        "--drop-old",
        action="store_true",
        help="清空旧集合后重建（全量重刷，生产环境谨慎使用）",
    )
    args = parser.parse_args()

    run_ingestion_pipeline(drop_old=args.drop_old)
