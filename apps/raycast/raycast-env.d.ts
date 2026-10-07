/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Phone Number - Your WhatsApp phone number with country code (e.g. 40712345678) */
  "phoneNumber": string,
  /** Daemon Port - Port for the local WhatsApp daemon */
  "daemonPort": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `send-link` command */
  export type SendLink = ExtensionPreferences & {}
  /** Preferences accessible in the `pick-link` command */
  export type PickLink = ExtensionPreferences & {}
  /** Preferences accessible in the `send-to-contact` command */
  export type SendToContact = ExtensionPreferences & {}
  /** Preferences accessible in the `auth` command */
  export type Auth = ExtensionPreferences & {}
  /** Preferences accessible in the `daemon-status` command */
  export type DaemonStatus = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `send-link` command */
  export type SendLink = {}
  /** Arguments passed to the `pick-link` command */
  export type PickLink = {}
  /** Arguments passed to the `send-to-contact` command */
  export type SendToContact = {}
  /** Arguments passed to the `auth` command */
  export type Auth = {}
  /** Arguments passed to the `daemon-status` command */
  export type DaemonStatus = {}
}

