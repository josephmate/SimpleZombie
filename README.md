
A 2D zombie survival game built with [Excalibur.js](https://excaliburjs.com/) v0.32.0 and TypeScript.

# Prerequisites

Install [Node.js](https://nodejs.org/) (LTS version recommended). This also installs `npm`, which is used to manage packages and run scripts.

# Setup (first time only)

Open a terminal in the project folder and run:

```
npm install
```

This downloads all dependencies (Excalibur, Vite, TypeScript, etc.) into a `node_modules` folder.

# Build

Compiles TypeScript and bundles everything into the `dist/` folder:

```
npm run build
```

# Run (development server)

Starts a local web server with live reload — the game opens in your browser automatically:

```
npm run dev
```

Then open `http://localhost:5173` in your browser if it doesn't open on its own.

## Testing on a phone (same WiFi)

Expose the server on your local network:

```
npm run dev -- --host
```

Vite will print a `Network:` URL like `http://192.168.x.x:5173/SimpleZombie/` — open that on your phone.

**First time only** — allow port 5173 through Windows Firewall (run in an admin PowerShell):

```
netsh advfirewall firewall add rule name="Vite Dev Server" dir=in action=allow protocol=TCP localport=5173
```

# Run (preview the built version)

To preview the production build instead of the dev version:

```
npm run build
npm run preview
```

Then open `http://localhost:4173` in your browser.

# Controls

| Key | Action |
|-----|--------|
| W | Move up |
| A | Move left |
| S | Move down |
| D | Move right |

# What's in the game

- **You** — blue star, placed randomly
- **Zombies** — pale green circles (20), chase you or hunt civilians; infect civilians on contact
- **Civilians** — dark grey circles (30), flee from nearby zombies; infect civilians on contact

# Plan

1. DONE: Base game and mechanics
  2. shooting
  3. infection
  4. corpses
  5. walls
2. DONE: everything moves slow over corpses
3. DONE: check for opportunities to refactor
  1. DONE: bring out input into a separate file and hide input type behind it (PC vs. mobile)
  2. DONE: level management out of main.ts
  3. DONE: hud moved out
  3. DONE: weapons moved out
  4. i believe i've done enough refactoring so that agent can more efficiently use context.
4. weapons through config files
  1. DONE: pistol
  2. DONE: shotgun
  3. DONE: rifle
  4. DONE: machine gun
  5. DONE: sniper rifle
  6. DONE: grenade launcher
  7. DONE: sand bag launch
5. DONE: tuning movement and weapons
   - defaults are already pretty good
6. DONE: tuning zombie movement so they don't clump ontop of eachother so much
7. DONE: line of sight wall check
8. DONE: refactor the different entities out:
    1. DONE: zombie
    2. DONE: civilian
9. ------ At this point the engine is finalized lets go with it ---------
9.  better level design that gives puzzles
10. sound
  11. for each weapon
    12. pistol
    13. rifle
    14. machine gun
    15. sniper rifle
    16. grenade launcher
    17. sand bag launch
  12. hiting zombie
  13. hiting civ
11. animations
   1. hitting zombie
   2. hitting civ
12. level editor that produces the ascii file
13. support opening a remote json file with the levels config so others can share
14. speed running options
    1.  timer for each level
    2.  timer from start to finish
