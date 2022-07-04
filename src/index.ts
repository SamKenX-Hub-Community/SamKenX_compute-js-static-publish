#!/usr/bin/env node

import commandLineArgs, { OptionDefinition } from "command-line-args";

import { initApp } from "./init-app.js";
import { buildStaticLoader } from "./build-static.js";

const optionDefinitions: OptionDefinition[] = [
  { name: 'preset', type: String, }, // (optional) Should be one of: cra (create-react-app), svelte
  { name: 'build-static', type: Boolean },
  { name: 'output', alias: 'o', type: String, defaultValue: './compute-js', },
  { name: 'public-dir', type: String, },
  { name: 'static-dir', type: String, },

  // List of files to automatically use as index, for example, index.html,index.htm
  // If a request comes in but the route does not exist, we check the route
  // plus a slash plus the items in this array.
  {
    name: 'auto-index',
    type: (val: string | null) => {
      if(val == null) {
        return null;
      }
      const values = val
        .split(',')
        .map(x => x.trim())
        .filter(x => x !== '');
      return values.length > 0 ? values : null;
    },
  },

  { name: 'spa', type: String, },
  { name: 'cra-eject', type: Boolean, defaultValue: false },
  { name: 'name', type: String, },
  { name: 'author', type: String, },
  { name: 'description', type: String, },
];

const commandLineValues = commandLineArgs(optionDefinitions);

console.log("Fastly Compute@Edge JavaScript Static Publisher");

if (commandLineValues['build-static']) {
  await buildStaticLoader();
  process.exit();
}

initApp(commandLineValues);
