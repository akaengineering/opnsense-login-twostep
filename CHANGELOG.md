# Changelog

## 1.0 (2026-10-21)

Initial release, written against OPNsense 26.7 (core `stable/26.7`).

- Two-step web GUI login form (username + password, then authentication code)
  injected through the SSO provider hook in `authgui.inc`.
- Reads token length and token order from the first TOTP authentication server
  (`totp` or `ldap-totp`) selected for the web GUI; login page stays stock when
  there is none.
- Client-side only: joins code and password into the stock password field and
  submits the stock form, so authentication and the POST body are unchanged.
- Progressive enhancement; falls back to the stock form when JavaScript is off
  or any expected element is missing.
