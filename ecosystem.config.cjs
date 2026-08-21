// PM2 process manifest for the Iyona backend EC2 host.
//
// Source of truth for *how* the app is launched lives here, in the repo,
// not in `~/.pm2/dump.pm2` on the box. Why this matters: if PM2 was ever
// started pointing at the wrong script path (e.g. during an incident),
// every subsequent `pm2 restart iyona` would silently relaunch the
// wrong file. With `pm2 startOrReload ecosystem.config.cjs` the path is
// re-asserted on every deploy, so the box converges back to whatever this
// file says — no manual `pm2 delete` needed to recover.
//
// The deploy workflow injects COMMIT_SHA / GIT_BRANCH / BUILD_TIME at run
// time via `--update-env`, so they are intentionally absent here.

module.exports = {
  apps: [
    {
      name: 'iyona',
      script: 'dist/main.js',
      cwd: '/home/ubuntu/iyona-backend',
      instances: 1,
      exec_mode: 'fork',
      // Cap RSS so a runaway request can't OOM the box. Tune if needed —
      // current steady-state is ~150 MB.
      max_memory_restart: '600M',
      // PM2's default unstable-restart cap is 16. If we hit that, the
      // workflow's health probe will already have failed and rolled back,
      // so we don't need to crank this up.
      env_production: {
        NODE_ENV: 'production',
        PORT: '4000',
      },
    },
  ],
};
