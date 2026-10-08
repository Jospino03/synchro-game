import { defineConfig } from "vite";

// "./" : les chemins du site sont relatifs, donc il fonctionne aussi bien
// sur https://pseudo.github.io/synchro-game/ que sur un domaine à la racine.
export default defineConfig({
    base: "./"
});