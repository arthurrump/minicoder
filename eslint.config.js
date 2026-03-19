import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import solid from "eslint-plugin-solid/configs/typescript";
import css from "@eslint/css";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // Set browser globals
  { 
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"], 
    plugins: { 
      js 
    }, 
    extends: ["js/recommended"], 
    languageOptions: { 
      globals: globals.browser 
    } 
  },
  // Recommended TypeScript configuration with type checked rules
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      }
    }
  },
  // Solid.js rules
  { 
    files: ["**/*.{ts,tsx}"], 
    ...solid 
  },
  // Custom CSS config
  { 
    files: ["**/*.css"], 
    plugins: { 
      css 
    }, 
    language: "css/css", 
    extends: [
      "css/recommended",
      tseslint.configs.disableTypeChecked
    ],
    rules: {
      // Enforce rem and em for font-sizes
      "css/relative-font-units": ["error", { allowUnits: ["rem", "em"] }],
      // The app is Chromium-only anyway, so no need for baseline CSS
      "css/use-baseline": "off",
      // Disabled, because it can't resolve variables and doesn't understand composes:
      "css/no-invalid-properties": "off",
    }
  },
  // Disabled typed linting on config files
  {
    files: ["*.config.{js,ts}"],
    extends: [tseslint.configs.disableTypeChecked]
  }
]);
