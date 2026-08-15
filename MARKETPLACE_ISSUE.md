### Repository URL

https://github.com/rpots/omarchy-cloudflare-warp

### Category

Widgets

### Tags

Bar, Quickshell, Security

### Suggest a missing tag

_No response_

### Maintainer notes

This is an independent, unofficial Omarchy plugin for the locally installed Cloudflare WARP client. It requires the community-maintained `cloudflare-warp-bin` AUR package; Cloudflare does not officially support Arch Linux. The plugin uses fixed `warp-cli` argument arrays, never edits WARP state files, and exposes only normalized IPC values. Starting a stopped daemon is separately confirmed and invokes only `pkexec systemctl enable --now warp-svc.service`. Consumer registration requires explicit Terms acceptance and a strict MDM preflight; managed configuration remains read-only. The root `preview.png` is a clean fabricated connected-state capture with no identifiers or proprietary logo asset.

### Submission checklist

- [ ] The repository is public and contains installation and removal instructions.
- [ ] I have documented the plugin license and any external dependencies.
- [ ] I confirm that I own or have permission to submit this plugin and its preview assets.
- [ ] The plugin does not overwrite user configuration without explicit consent.
- [ ] I understand that approval is for listing and is not a security review.
