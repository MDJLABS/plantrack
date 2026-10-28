// tests/guide/support/register.mjs — point d'entrée --import qui CÂBLE resolve-ts.mjs dans la
// résolution ESM (même idiome que register-alias.mjs côté miamboost, cf. ce fichier).
import { register } from "node:module";
register("./resolve-ts.mjs", import.meta.url);
