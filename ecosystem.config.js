"use strict";
// PM2 ecosystem config for CrossX production deployment.
// Usage:  pm2 start ecosystem.config.js --env production
//         pm2 save && pm2 startup
module.exports = {
  apps: [{
    name:         "crossx",
    script:       "server.js",
    instances:    1,          // SQLite WAL — single process only
    exec_mode:    "fork",
    env_file:     ".env.local",
    env_production: {
      NODE_ENV: "production",
      PORT:     "8787",
      HOST:     "127.0.0.1",
    },
    // Restart policy — exponential backoff prevents crash-loop storms
    // (starts at 100 ms, doubles each restart, caps at ~15 s by PM2)
    max_restarts:            10,
    min_uptime:              "10s",
    exp_backoff_restart_delay: 100,
    // Logs
    out_file:  "logs/out.log",
    error_file:"logs/err.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    merge_logs: true,
    // Memory guard — restart if process exceeds 512 MB
    max_memory_restart: "512M",
    // Graceful shutdown: wait up to 8s for SSE streams to drain
    kill_timeout: 8000,
  }],
};
