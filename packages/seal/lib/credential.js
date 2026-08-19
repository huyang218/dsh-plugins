/**
 * Where the signing credential lives when the client configures it.
 *
 * The profile's `cordis.patch.yml` is the wrong home for a passphrase: it is a
 * plain file that gets backed up, synced between machines, committed by
 * accident and pasted into issues, and the settings form does not even mask it.
 * A credential set from the client goes into the storage domain instead —
 * durable, per-installation, and not part of the config anyone copies around.
 *
 * That is better, not safe. It is still at rest unencrypted, readable by
 * anything running as this user. What it buys is that the passphrase stops
 * travelling with the configuration, which is where these leaks actually come
 * from. The README says so in those words rather than implying a keychain.
 *
 * @module dsh-plugin-seal/credential
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** The one row: there is a single signing identity per installation. */
export const CREDENTIAL_DOMAIN = defineDomain({
  name: 'seal_credential',
  version: 1,
  tables: {
    signing: domainTable(z.object({
      p12Path: z.string(),
      passphrase: z.string(),
      updatedAt: z.number().optional(),
    })),
  },
})

/** Key of the single row, so reads and writes cannot disagree about it. */
export const ROW = 'default'

/**
 * A credential store over an open domain table, or a memory-only stand-in.
 *
 * Memory-only rather than refusing to load: without a storage backend the
 * client cannot save a credential, but the tools still work with a path passed
 * per call or set in the config, and a plugin that refuses to load would take
 * stamping down with it.
 *
 * @param {Object} [table] - the storage table, when one is available.
 * @returns {Object} `{ read, write, clear, durable }`
 */
export function createStore(table) {
  let memory
  if (table === undefined) {
    return {
      durable: false,
      read: async () => memory,
      write: async value => { memory = { ...value, updatedAt: Date.now() } },
      clear: async () => { memory = undefined },
    }
  }
  return {
    durable: true,
    read: async () => table.get(ROW),
    write: async value => { await table.put(ROW, { ...value, updatedAt: Date.now() }) },
    clear: async () => { await table.delete(ROW) },
  }
}

/**
 * What the client is allowed to see about the stored credential.
 *
 * Never the passphrase. A settings page needs to show whether one is set, not
 * what it is — and a route that returns it would put the passphrase into every
 * browser cache and devtools log that ever opened the page.
 *
 * @param {Object} [stored] - the stored row.
 * @param {Object} [state] - `{ durable }` from the store.
 * @returns {Object} the safe projection
 */
export function publicView(stored, { durable = true } = {}) {
  return {
    p12Path: stored?.p12Path ?? '',
    hasPassphrase: typeof stored?.passphrase === 'string' && stored.passphrase.length > 0,
    updatedAt: stored?.updatedAt ?? 0,
    durable,
  }
}

/**
 * Validate what the client sent before it is stored.
 *
 * @param {Object} body - the parsed request body.
 * @returns {Object} `{ p12Path, passphrase }`
 * @throws when the shape is not what a credential looks like
 */
export function readSubmission(body) {
  const p12Path = String(body?.p12Path ?? '').trim()
  if (p12Path.length === 0) throw new Error('seal: give the path to the .p12 certificate bundle')
  if (!/\.(p12|pfx)$/i.test(p12Path)) {
    // A .cer or .pem holds no private key, and the failure that follows would
    // be about ASN.1 rather than about the file being the wrong half.
    throw new Error(`seal: "${p12Path}" is not a .p12/.pfx bundle — the .cer is the public half and cannot sign`)
  }
  const passphrase = typeof body?.passphrase === 'string' ? body.passphrase : ''
  return { p12Path, passphrase }
}
