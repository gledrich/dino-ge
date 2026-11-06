GitHub Pages publishes the docs directory on main through GitHub's generated
pages-build-deployment workflow. The chapter Markdown has Jekyll front matter.
The demo import maps pin the public npm engine and Amber Ruins release assets
to v1.16.0-beta.1, so the standard Pages build can run them without a Node step.
Update those pins and the install command in the first chapter together after
checking that a new release has been published.

To build a self-contained preview from the repository root:

    npm ci
    npm run docs:pages

The build generates matching engine modules and TypeDoc output in dist/pages/.
It uses local copies of the assets so the preview can run without the CDN.
The checked-in Publish to NPM workflow publishes the engine and Playground
packages. It does not deploy the docs.

For a prefix-aware local preview:

    mkdir -p dist/preview
    ln -sfn ../pages dist/preview/dino-ge
    python3 -m http.server --bind 127.0.0.1 --directory dist/preview 4175

Open http://127.0.0.1:4175/dino-ge/index.html.
