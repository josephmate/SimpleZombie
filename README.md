# SimpleZombie

A 2D zombie survival game built with [Excalibur.js](https://excaliburjs.com/) v0.32.0 and TypeScript.

## Prerequisites

Install [Node.js](https://nodejs.org/) (LTS version recommended). This also installs `npm`, which is used to manage packages and run scripts.

## Setup (first time only)

Open a terminal in the project folder and run:

```
npm install
```

This downloads all dependencies (Excalibur, Vite, TypeScript, etc.) into a `node_modules` folder.

## Build

Compiles TypeScript and bundles everything into the `dist/` folder:

```
npm run build
```

## Run (development server)

Starts a local web server with live reload — the game opens in your browser automatically:

```
npm run dev
```

Then open `http://localhost:5173` in your browser if it doesn't open on its own.

## Run (preview the built version)

To preview the production build instead of the dev version:

```
npm run build
npm run preview
```

Then open `http://localhost:4173` in your browser.

## Controls

| Key | Action |
|-----|--------|
| W | Move up |
| A | Move left |
| S | Move down |
| D | Move right |

## What's in the game

- **You** — blue star, placed randomly
- **Zombies** — pale green circles (20), chase you or hunt civilians; infect civilians on contact
- **Civilians** — dark grey circles (30), flee from nearby zombies; infect civilians on contact