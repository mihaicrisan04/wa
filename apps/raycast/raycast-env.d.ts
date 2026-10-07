/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Token - wa engine token; leave empty to use the one the engine writes to ~/Library/Application Support/wa/tokens/raycast.token */
  "token"?: string,
  /** Port - Port of the local wa engine */
  "port": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `send-to-self` command */
  export type SendToSelf = ExtensionPreferences & {}
  /** Preferences accessible in the `send-to-chat` command */
  export type SendToChat = ExtensionPreferences & {}
  /** Preferences accessible in the `pick-item` command */
  export type PickItem = ExtensionPreferences & {}
  /** Preferences accessible in the `search-messages` command */
  export type SearchMessages = ExtensionPreferences & {}
  /** Preferences accessible in the `link` command */
  export type Link = ExtensionPreferences & {}
  /** Preferences accessible in the `status` command */
  export type Status = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `send-to-self` command */
  export type SendToSelf = {}
  /** Arguments passed to the `send-to-chat` command */
  export type SendToChat = {}
  /** Arguments passed to the `pick-item` command */
  export type PickItem = {}
  /** Arguments passed to the `search-messages` command */
  export type SearchMessages = {}
  /** Arguments passed to the `link` command */
  export type Link = {}
  /** Arguments passed to the `status` command */
  export type Status = {}
}

