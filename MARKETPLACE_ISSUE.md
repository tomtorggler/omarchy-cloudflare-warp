# [Plugin]: Cloudflare WARP

This is an independent, unofficial Omarchy plugin for the Cloudflare® WARP® client. It is unaffiliated with and not endorsed, sponsored, or supported by Cloudflare, Inc. or Omarchy.

Cloudflare® and WARP® are trademarks and/or registered trademarks of Cloudflare, Inc. in the United States and other jurisdictions.

- Repository: `https://github.com/rpots/omarchy-cloudflare-warp`
- Category: Widgets
- Tags: `Bar`, `Quickshell`, `Security`
- Plugin ID: `io.github.rui-pedro-silva.cloudflare-warp`
- License: MIT

It provides status and consumer-safe connection/DNS controls in a theme-native, keyboard-driven Omarchy bar panel. The plugin executes fixed argument arrays, never reads or writes WARP state files directly, bounds subprocesses, and exposes only allowlisted categorical IPC values. Terms acceptance is explicitly confirmed; only that consent persists as a native non-secret boolean so Linux 2026.6’s invocation-scoped `--accept-tos` requirement can be applied consistently. A strict JSON `mdm get-configs` check permits registration only when no active or available MDM configuration exists, and an existing registration is adopted without deletion. Starting a stopped daemon is separately confirmed and invokes only `pkexec systemctl enable --now warp-svc.service`; this privilege and service-management capability requires marketplace review.

Pre-submission checklist:

- [ ] Public repository created and release tag `v1.0.0` published
- [ ] `omarchy plugin validate .` passes
- [ ] Node test and contract CI passes
- [ ] Live-shell smoke checklist passes
- [ ] Real consumer fixtures captured for Families Off, Malware, and Full
- [ ] Security baseline reviewed
- [ ] `preview.png` contains fabricated data only
- [ ] Repository documents installation, removal, dependencies, and license
- [ ] Submitter owns or has permission to publish the plugin and preview
- [ ] Plugin does not overwrite user configuration without explicit consent
- [ ] Listing approval is understood not to be a security certification

Prepared only; do not submit without explicit authorization.
