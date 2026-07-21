# Pi Vendoring

This repository vendors Pi Coding Agent at `vendor/pi-coding-agent/`.

Reason:

- the developer has a global `pi` installation in active use
- EBM-specific changes must not mutate or shadow the global installation
- future work may remove unused Pi internals or patch provider/tool behavior for EBM

The vendored copy excludes `node_modules` to keep the repository smaller. Root `package.json` depends on it via:

```json
"@earendil-works/pi-coding-agent": "file:vendor/pi-coding-agent"
```

Update procedure:

```bash
rsync -a --delete --exclude node_modules \
  ~/.nvm/versions/node/v24.14.1/lib/node_modules/@earendil-works/pi-coding-agent/ \
  vendor/pi-coding-agent/
npm install
npm run check
```

If project-specific Pi modifications are needed, patch files under `vendor/pi-coding-agent/` and add regression tests at the EBM root before changing behavior.
