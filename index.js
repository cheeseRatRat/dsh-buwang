/**
 * Host half of 不忘.
 *
 * Responsibilities:
 *   - own the data directory (create it on first run)
 *   - keep the always-on index text fresh (every 20s and after each write)
 *   - register the four memory tools
 *   - register one prompt section carrying the index
 *   - serve the panel over one RPC channel
 *
 * Compatibility: every host API call this plugin makes is in this file or in
 * `src/host/*.js`, so a DSH upgrade has one place to adapt.
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  FORMAT,
  resolveDataDir,
  ensureData,
  readState,
  writeSettings,
  revealFolder,
  revealItem,
  pickFolder,
  setDataRoot,
  resetRootPointer,
  setWorkshopMode,
  saveDoc,
  createWorkshopDoc,
  setActivePersona,
  createPersona,
  deletePersona,
  setPersonaShare,
  archiveTongyou,
  moveToSealed,
  unseal,
  restorePersona,
  buildIndexText,
  backupLibrary,
} from './src/host/store.js'
import { createTools } from './src/host/tools.js'

export const inject = ['connection', 'tools', 'systemPrompt']

const SECTION_NAME = 'buwang-memory-index'
const SECTION_ORDER = 95
const REFRESH_MS = 20000
const VERSION = 'v5'

export function apply(ctx, config) {
  const root = resolveDataDir(config && config.dataDir)

  // Diagnostics land next to the library: a headless activation failure is
  // otherwise invisible from inside the session.
  const debugPath = path.join(root, '_debug.log')
  const DEBUG_MAX = 256 * 1024
  const dbg = (message) => {
    const line = new Date().toISOString() + ' ' + VERSION + ' ' + message + '\n'
    // 日志只是诊断用，别让它长成库里的第二本书：过 256KB 就清空重来
    fs.stat(debugPath)
      .then((stat) => (stat.size > DEBUG_MAX ? fs.writeFile(debugPath, '', 'utf8') : null))
      .catch(() => {})
      .then(() => fs.appendFile(debugPath, line, 'utf8'))
      .catch(() => {})
  }

  dbg('apply start, root=' + root)

  let cached = ''

  const loadIndex = async () => {
    try {
      const state = await readState(root)
      cached = buildIndexText(state)
    } catch {
      // keep the previous text; an unreadable library must not break a turn
    }
  }

  const refresh = () => {
    loadIndex().catch(() => {})
  }

  ctx.effect(() => {
    ensureData(root)
      .then(() => {
        dbg('ensureData ok')
        return loadIndex()
      })
      .catch((error) => dbg('ensureData failed: ' + String(error)))
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      clearInterval(timer)
    }
  })

  /* ---------------- panel RPC ---------------- */

  const dispatch = {
    async state() {
      const state = await readState(root)
      return { ...state, format: FORMAT }
    },

    async saveSettings(payload) {
      const patch = payload && typeof payload === 'object' ? payload.settings || payload : {}
      const settings = await writeSettings(root, patch)
      refresh()
      return { settings }
    },

    async reveal(payload) {
      const body = payload && typeof payload === 'object' ? payload : {}
      // An item lands in its parent folder (so a beginner sees where it sits);
      // a bare folder name still opens that folder.
      if (typeof body.path === 'string' && body.path) {
        return revealItem(root, body.path)
      }
      const which = typeof body.which === 'string' ? body.which : ''
      const target = await revealFolder(root, which)
      return { path: target }
    },

    /**
     * Repoint the library: pick a folder, then either carry the files along or
     * simply aim at a new (or existing) folder. The host only learns the new
     * root on reload, so every answer says so.
     */
    async root(payload) {
      const body = payload && typeof payload === 'object' ? payload : {}
      const action = String(body.action || 'set')

      if (action === 'pick') {
        return pickFolder(body.initial || root)
      }
      if (action === 'reset') {
        const result = await resetRootPointer()
        return { root: resolveDataDir(config && config.dataDir), ...result, needsReload: true }
      }
      const result = await setDataRoot(root, body.target, { move: body.move === true })
      dbg('root switched: ' + result.root + ' (move=' + result.moved + ')')
      return result
    },

    async workshopMode(payload) {
      const relPath = payload && typeof payload.path === 'string' ? payload.path : ''
      const always = payload ? payload.always === true : false
      const result = await setWorkshopMode(root, relPath, always)
      refresh()
      return result
    },

    async editDoc(payload) {
      const body = payload && typeof payload === 'object' ? payload : {}
      // The panel's 「写一个技能」 button: a brand-new workshop document, where
      // `doc` alone only edits what already exists.
      if (body.action === 'create-workshop') {
        const created = await createWorkshopDoc(root, body)
        refresh()
        return created
      }
      const result = await saveDoc(root, body.path, body)
      refresh()
      return result
    },

    /**
     * Persona actions: create one more, or switch which one is active.
     * Activating is exclusive by design — the settings hold a single key.
     */
    async persona(payload) {
      const body = payload && typeof payload === 'object' ? payload : {}
      if (body.action === 'create') {
        const result = await createPersona(root, {
          title: body.title,
          summary: body.summary,
          body: body.body,
        })
        refresh()
        return result
      }
      if (body.action === 'activate') {
        const result = await setActivePersona(root, String(body.key || ''))
        refresh()
        return result
      }
      if (body.action === 'delete') {
        const result = await deletePersona(root, String(body.key || ''))
        refresh()
        return result
      }
      if (body.action === 'share') {
        const result = await setPersonaShare(
          root,
          String(body.key || ''),
          Array.isArray(body.shareFrom) ? body.shareFrom : []
        )
        refresh()
        return result
      }
      throw new Error('未知的人格操作')
    },

    /** Trim 同游: the newest items stay, everything older moves to 长期. */
    async tidyTongyou(payload) {
      const body = payload && typeof payload === 'object' ? payload : {}
      const result = await archiveTongyou(root, body.keep)
      refresh()
      return result
    },

    /** Copy the whole library next to itself; the panel shows where it went. */
    async backup() {
      const result = await backupLibrary(root)
      dbg('backup: ' + result.path + ' (' + result.files + ' files)')
      return result
    },

    /** Seal or unseal a single document. Both directions keep the bytes. */
    async seal(payload) {
      const body = payload && typeof payload === 'object' ? payload : {}
      const path = String(body.path || '')
      // A sealed persona is a whole box, not a file: it comes home as a persona.
      let result
      if (body.action === 'restore-persona') result = await restorePersona(root, path)
      else if (body.action === 'unseal') result = await unseal(root, path)
      else result = await moveToSealed(root, path)
      refresh()
      return result
    },
  }

  // DSH's `connection.rpc.handle` registers its route from an effect fiber that
  // cannot see `webServer`, so this plugin carries its own exact routes.
  // `requestRejection` keeps the same trust fence the shared channel applies.
  const readJson = (req) =>
    new Promise((resolve) => {
      const chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
        } catch {
          resolve({})
        }
      })
      req.on('error', () => resolve({}))
    })

  const sendJson = (res, status, value) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(value))
  }

  ctx.inject(['connection', 'webServer'], (rpcCtx) => {
    dbg('inject child fired; webServer=' + typeof rpcCtx.webServer)

    const routes = [
      {
        path: '/buwang/state',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            sendJson(res, 200, await dispatch.state())
          } catch (error) {
            dbg('state failed: ' + String(error))
            sendJson(res, 500, { error: String(error) })
          }
        },
      },
      {
        path: '/buwang/settings',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            const payload = await readJson(req)
            sendJson(res, 200, await dispatch.saveSettings(payload))
          } catch (error) {
            dbg('settings failed: ' + String(error))
            sendJson(res, 500, { error: String(error) })
          }
        },
      },
      {
        path: '/buwang/reveal',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            const payload = await readJson(req)
            sendJson(res, 200, await dispatch.reveal(payload))
          } catch (error) {
            dbg('reveal failed: ' + String(error))
            sendJson(res, 500, { error: String(error) })
          }
        },
      },
      {
        path: '/buwang/root',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            const payload = await readJson(req)
            sendJson(res, 200, await dispatch.root(payload))
          } catch (error) {
            dbg('root failed: ' + String(error))
            sendJson(res, 500, { error: String(error) })
          }
        },
      },
      {
        path: '/buwang/workshop-mode',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            const payload = await readJson(req)
            sendJson(res, 200, await dispatch.workshopMode(payload))
          } catch (error) {
            dbg('workshop-mode failed: ' + String(error))
            sendJson(res, 400, { error: String((error && error.message) || error) })
          }
        },
      },
      {
        path: '/buwang/doc',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            const payload = await readJson(req)
            sendJson(res, 200, await dispatch.editDoc(payload))
          } catch (error) {
            dbg('doc failed: ' + String(error))
            sendJson(res, 400, { error: String((error && error.message) || error) })
          }
        },
      },
      {
        path: '/buwang/persona',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            const payload = await readJson(req)
            sendJson(res, 200, await dispatch.persona(payload))
          } catch (error) {
            dbg('persona failed: ' + String(error))
            sendJson(res, 400, { error: String((error && error.message) || error) })
          }
        },
      },
      {
        path: '/buwang/tidy',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            const payload = await readJson(req)
            sendJson(res, 200, await dispatch.tidyTongyou(payload))
          } catch (error) {
            dbg('tidy failed: ' + String(error))
            sendJson(res, 400, { error: String((error && error.message) || error) })
          }
        },
      },
      {
        path: '/buwang/backup',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            sendJson(res, 200, await dispatch.backup())
          } catch (error) {
            dbg('backup failed: ' + String((error && error.message) || error))
            sendJson(res, 400, { error: String((error && error.message) || error) })
          }
        },
      },
      {
        path: '/buwang/seal',
        handler: async (req, res) => {
          const rejection = rpcCtx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            const payload = await readJson(req)
            sendJson(res, 200, await dispatch.seal(payload))
          } catch (error) {
            dbg('seal failed: ' + String(error))
            sendJson(res, 400, { error: String((error && error.message) || error) })
          }
        },
      },
    ]

    rpcCtx.effect(() => {
      const disposers = []
      for (const route of routes) {
        try {
          disposers.push(rpcCtx.webServer.register({ kind: 'exact', path: route.path, handler: route.handler }))
          dbg('route registered: ' + route.path)
        } catch (error) {
          dbg('route FAILED: ' + route.path + ' ' + String((error && error.message) || error))
        }
      }
      return () => {
        for (const dispose of disposers) {
          try {
            dispose && dispose()
          } catch {
            // ignore
          }
        }
      }
    })
  })

  /* ---------------- tools ---------------- */

  ctx.effect(() => {
    const disposers = []
    let count = 0
    try {
      for (const definition of createTools({ root, refresh })) {
        try {
          disposers.push(ctx.tools.register(definition))
          count += 1
        } catch (error) {
          dbg('tool failed: ' + definition.name + ' ' + String((error && error.message) || error))
        }
      }
    } catch (error) {
      dbg('tools registry unavailable: ' + String((error && error.message) || error))
    }
    dbg('tools registered: ' + count)
    return () => {
      for (const dispose of disposers) {
        try {
          dispose && dispose()
        } catch {
          // ignore
        }
      }
    }
  })

  /* ---------------- prompt section ---------------- */

  ctx.effect(() => {
    try {
      dbg('prompt section registered')
      return ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: () => cached,
      })
    } catch (error) {
      dbg('prompt section failed: ' + String((error && error.message) || error))
      return () => {}
    }
  })
}
