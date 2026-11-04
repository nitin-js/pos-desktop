# pos-desktop

POS client for cashiers. The same React application runs in the browser as a PWA and, from Phase 9, inside Electron. Business Admin and Super Admin are `pos-admin-frontend`. The API and the database are `pos-backend`.

## Design

- [Architecture](docs/ARCHITECTURE.md)
- [Screens](docs/SCREENS.md)
- [Offline client](docs/OFFLINE.md)

Stock sync rules are canonical in `pos-backend/docs/OFFLINE-SYNC.md`.

## Boundaries

- Selling, shifts, receipts, barcode entry, offline outbox, and desktop hardware.
- No tenant administration, no module assignment, no direct MongoDB connection.
- Offline sales are cash sales. The server applies stock as deltas and can flag an oversell. This app does not upload a replacement on-hand quantity.
- The renderer stays free of Node imports so the browser build and the Electron build share one UI.

## Status

Phase 1 is documentation. Phase 2 adds the Vite application. Electron and SQLite arrive in Phase 9. The browser build uses IndexedDB for the outbox in Phase 7.
