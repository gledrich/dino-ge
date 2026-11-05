# Dino GE website design

Launch scope: a free public website with the full browser Playground. Projects are stored in the visitor’s browser and can be exported.

## Visitor journeys

| Route | Purpose | Primary action |
| --- | --- | --- |
| `/` | Explain what Dino GE is and show what it can make | Open the Playground |
| `/docs/` | Help developers install the engine and build a first scene | Follow the quickstart |
| `/docs/api/` | Provide searchable TypeDoc reference for the same engine build | Look up a class or method |
| `/playground/` | Run and edit an example with the existing Playground tools | Run a change in Amber Ruins |

The home page opens with “Build 2D games for the web” and describes Dino GE as a TypeScript engine for browser games. Put **Open Playground** and **Read the docs** next to the introduction. Pair that copy with a still from Amber Ruins. Below the opening, use Amber Ruins to explain how scenes, tilemaps, input and audio come together, then link directly to the quickstart and source repository. Use real game artwork, warm amber accents and a dark ink background. Keep the opening copy and both actions ahead of the artwork on narrow screens.

Home, Docs and Playground share navigation and an active section indicator. The documentation starts with installation and a runnable first scene, then explains scenes, game objects and components. Use the existing TypeDoc build for class and method details. Generate it alongside the site against the engine version available in the Playground. The editor uses its existing viewport, file browser, source editor, console, scene explorer and inspector. The website pages adapt to narrow screens. The Playground’s narrow-screen controls are developed separately in the main checkout.

The quickstart teaches the engine through a small relic collection game. Learners draw a shape, move it with keyboard input on fixed simulation steps, and collect a second object using a distance check. Each step gives them a change to try and a result they can check. The finished example runs in the guide and links to the corresponding mechanics in Amber Ruins.

## Hosting approaches

- **Selected approach.** Serve the home page, docs, engine, editor and preview as static assets. Use a free provider subdomain for launch. Store anonymous projects in the browser so editing and running games need no workspace server. [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) covers static asset requests.
- **Node service with server workspaces.** This fits the existing Express storage design but requires durable storage and a workspace API for anonymous users. A free Render service sleeps when idle and loses local writes on restart. [Render free service limits](https://render.com/docs/free)
- **Static site with a playable demo.** Host the home page, docs and Amber Ruins without a server and distribute the current editor as a local tool. This reduces hosting work but removes in-browser editing from the public site.

## Public Playground boundary

Create a local workspace on first use, with a writable copy of Amber Ruins. Use IndexedDB for project files and assets. Show that saves belong to this browser and provide an export that includes the complete folder tree. Preserve relative paths on import, reject unsafe paths, and report storage failures without claiming an edit was saved. Keep the npm CLI's existing filesystem workspace through a separate storage adapter.

The current editor injects modules into its own document and directly reads engine state. In the public Playground, run each game in a fresh sandboxed frame on a separate origin with its own engine instance. Give the preview a read-only snapshot of the selected project and no editor credentials. Prototype how that snapshot resolves nested imports, `import.meta.url` and asset requests entirely in the browser before choosing the module delivery mechanism. Use a validated message bridge for pause, selection, property editing, scene snapshots and console output. Keep script writes and imports in the editor. A fresh frame on rerun discards the old game and gives the browser a new module graph.

Creator, cloud sync and billing are deferred to a future release.

## Acceptance

- From a clean build, open the site and follow the home-page links to the quickstart, API reference and editor. Run the quickstart against the engine version the site serves.
- Check navigation, visible keyboard focus and content layout on desktop and narrow screens. Check that the main actions remain visible and usable without the showcase media.
- In the hosted editor, edit and run Amber Ruins, reload and recover the saved edit, import a project with a nested module and asset, inspect and change a scene property, and verify that rerun replaces the previous game.
- Use separate browser contexts to verify local project separation. Verify that game code cannot access the editor document, editor storage or another project's files. Verify that export and reimport preserve nested files and assets.
- Verify the npm CLI still opens a local workspace and the public site build serves its own reference, assets and direct links without relying on an existing Pages deployment.
