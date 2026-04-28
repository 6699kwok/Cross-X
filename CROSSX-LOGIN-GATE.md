# CrossX 强制登录功能实现

## 📋 需求
根据合规要求，用户必须登录后才能使用 CrossX 服务。

## ✅ 已完成功能

### 1. 强制登录门禁
- **文件**: `web/app.js`
- **实现**:
  - `_showLoginModal(opts)` 接受 `opts.required` 参数
  - 当 `required: true` 时：
    - 隐藏关闭按钮（×）
    - 禁用背景遮罩点击关闭
    - 隐藏"以访客身份继续"按钮
    - 显示黄色合规提示横幅
  - `_initAuthState()` 在用户未登录时自动调用 `_showLoginModal({ required: true })`

### 2. 多种登录方式
现已支持 **6 种**登录方式：

#### OAuth 社交登录（一键登录）
1. **Google** - 默认显示，国际用户首选
2. **Facebook** - 新增，需后端配置
3. **WeChat 微信** - 中国用户首选
4. **Alipay 支付宝** - 新增，需后端配置

#### 传统登录方式
5. **手机号 + OTP** - 支持 20+ 国家区号
6. **邮箱 + OTP** - 国际通用

### 3. UI 改进
- **合规提示横幅**: 黄色警告框显示"根据合规要求，使用本服务需要登录"
- **副标题**: 强制模式下显示"请登录后使用 CrossX"
- **按钮样式**:
  - Facebook: 蓝色 `#1877f2`
  - Alipay: 蓝色 `#1678ff`
  - 所有按钮支持 hover 效果

## 📁 修改文件

### `web/app.js`
```javascript
// Line 19023-19025
function _showLoginModal(opts) {
  const _loginRequired = opts && opts.required === true;
  // ...
}

// Line 18865-18878
async function _initAuthState() {
  // ...
  if (!token) {
    _applyAuthUi(false);
    _showLoginModal({ required: true }); // 强制登录
    return;
  }
  // ...
}
```

### `web/styles.css`
```css
/* Line 8175-8182 */
.cx-modal-btn-facebook { background:#1877f2; color:#fff; display:flex; align-items:center; justify-content:center; }
.cx-modal-btn-facebook:hover { background:#166fe5; }
.cx-modal-btn-alipay { background:#1678ff; color:#fff; display:flex; align-items:center; justify-content:center; }
.cx-modal-btn-alipay:hover { background:#0d6efd; }
```

## 🔧 后端配置需求

### Facebook OAuth
需要在 `server.js` 中添加：
```javascript
// GET /api/auth/facebook
// GET /api/auth/facebook/callback
```

### Alipay OAuth
需要在 `server.js` 中添加：
```javascript
// GET /api/auth/alipay
// GET /api/auth/alipay/callback
```

### Provider 检测 API
`/api/system/providers` 需要返回：
```json
{
  "google_oauth": true,
  "facebook_oauth": false,  // 需要配置
  "wechat_oauth": true,
  "alipay_oauth": false     // 需要配置
}
```

## 🧪 测试步骤

1. **清除本地存储**:
   ```javascript
   localStorage.clear();
   ```

2. **刷新页面**: 应立即显示登录弹窗

3. **检查 UI**:
   - ✓ 右上角无关闭按钮（×）
   - ✓ 点击背景灰色区域无反应
   - ✓ 黄色合规提示横幅显示
   - ✓ 底部无"以访客身份继续"按钮
   - ✓ 显示 Google、Facebook、WeChat、Alipay 按钮（根据配置）

4. **登录测试**:
   - 选择任意登录方式
   - 登录成功后弹窗自动关闭
   - 可正常使用应用

## 📊 用户体验流程

```
用户访问 CrossX
    ↓
检测 localStorage token
    ↓
无 token → 显示强制登录弹窗
    ↓
用户选择登录方式:
  - Google (一键)
  - Facebook (一键)
  - WeChat (一键)
  - Alipay (一键)
  - 手机号 + OTP
  - 邮箱 + OTP
    ↓
登录成功 → 弹窗关闭 → 正常使用
```

## 🔒 安全特性

1. **Token 验证**: 每次页面加载时调用 `/api/auth/me` 验证 token
2. **HttpOnly Cookie**: 服务端设置 `cx_token` cookie（防 XSS）
3. **无绕过**: 强制模式下无法关闭弹窗，必须登录
4. **合规提示**: 明确告知用户登录是合规要求

## 📝 待办事项

- [ ] 后端实现 Facebook OAuth (`/api/auth/facebook`, `/api/auth/facebook/callback`)
- [ ] 后端实现 Alipay OAuth (`/api/auth/alipay`, `/api/auth/alipay/callback`)
- [ ] 更新 `/api/system/providers` 返回 `facebook_oauth` 和 `alipay_oauth` 字段
- [ ] 测试所有登录方式的完整流程
- [ ] 添加登录失败的错误处理和重试机制

## 🎨 UI 截图说明

强制登录弹窗应包含：
1. CrossX Logo + 标题
2. 黄色合规提示横幅（⚠️ 图标）
3. 4 个 OAuth 按钮（Google/Facebook/WeChat/Alipay）
4. 分隔线："或用手机/邮箱登录"
5. 手机号/邮箱切换标签
6. 输入框 + 发送验证码按钮
7. **无**关闭按钮
8. **无**访客模式按钮

---

**实现日期**: 2026-03-16
**版本**: v1.0
**状态**: ✅ 前端完成，等待后端 Facebook/Alipay OAuth 实现
