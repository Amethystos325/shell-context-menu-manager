# Shell Context Menu Manager

Electron + React + TypeScript desktop app for visual editing of Nilesoft Shell menu configuration.

## Environment

1. Node.js `v22.x` (current baseline: `v22.18.0`)
2. npm `11.x`

## Scripts

1. `npm run dev`: start Vite renderer + Electron app (development mode)
2. `npm run build`: build renderer and Electron main/preload output
3. `npm run start`: run built Electron app
4. `npm run lint`: run ESLint
5. `npm run typecheck`: run TypeScript checks
6. `npm run core:smoke`: run parser/serializer/validator smoke tests
7. `npm run editor:smoke`: run editor tree-operation smoke tests

## Stage 1 Delivered

1. Electron process split:
   - `electron/main.ts`
   - `electron/preload.ts`
   - `src/*` renderer
2. Security baseline:
   - `contextIsolation: true`
   - `nodeIntegration: false`
   - IPC channel whitelist
3. IPC test capabilities:
   - read text file
   - write text file
   - fetch app info
   - stream operation logs

## Stage 2 Delivered

1. Config core modules:
   - parser: `src/core/parser.ts`
   - serializer: `src/core/serializer.ts`
   - validator: `src/core/validator.ts`
   - diff model: `src/core/diff.ts`
2. Unified workflow helpers:
   - `parseAndValidate`
   - `roundTrip`
3. Internal smoke coverage with 10 sample configs:
   - `scripts/core-smoke.ts`
   - `samples/configs/*.nss`

## Docs

1. Development plan: `docs/Develop_Plan.md`
2. Progress tracking: `docs/Develop_Progress.md`
3. Phase 0 artifacts:
   - `docs/Phase0_Feature_Freeze.md`
   - `docs/Phase0_Page_Flow.md`
