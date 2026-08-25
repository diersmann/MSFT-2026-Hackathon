# WidgetWorks

A deliberately ordinary little app. It exists so the readiness linter and `/split`
have a real codebase to check paths against — an issue that says
"update `src/reports/export.js`" should be verifiably about a file that exists,
and one that names `src/legacy/adapter-v1.js` should be caught as stale.

## Layout

```
src/auth/login.js        session handling
src/reports/export.js    CSV export, still on moment
src/settings/panel.js    the settings page, pre-design-system
src/settings/fields.js   individual field components
src/api/search.js        /api/search handler
docs/releasing.md        release process
```

## Running

```bash
npm install
npm test
```
