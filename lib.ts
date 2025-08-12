import Cloudflare from 'cloudflare'
import { walk } from '@std/fs'
import { calculateFileHash } from './util.ts'
import { encodeBase64 } from '@std/encoding/base64'
import { relative } from '@std/path'

export type DeployConfig = {
  name: string
  compatibility_date: string
  main?: string
  assets?: Cloudflare.Workers.ScriptUpdateParams.Metadata.Assets.Config & {
    binding?: string
    directory: string
  }
}

export const deploy = async (
  config: DeployConfig,
  options?: {
    api_token?: string
    account_id?: string
  },
): Promise<void> => {
  const { api_token, account_id } = (() => {
    const opt = options ?? { api_token: undefined, account_id: undefined }
    if (!opt.api_token) {
      opt.api_token = Deno.env.get('CLOUDFLARE_API_TOKEN')
    }
    if (!opt.account_id) {
      opt.account_id = Deno.env.get('CLOUDFLARE_ACCOUNT_ID')
    }
    return opt
  })()
  if (!api_token || !account_id) {
    throw new Error('missing apiToken or account_id')
  }

  const client = new Cloudflare({
    apiToken: api_token,
  })

  if (config.assets) {
    const manifest: {
      [
        key: string
      ]: Cloudflare.Workers.Scripts.Assets.Upload.UploadCreateParams.Manifest
    } = {}
    const filesBase64: {
      [key: string]: string
    } = {}
    for await (const entry of walk(config.assets.directory)) {
      if (entry.isFile) {
        const { fileHash, fileSize } = calculateFileHash(entry.path)
        manifest[`/${relative(config.assets.directory, entry.path)}`] = {
          hash: fileHash,
          size: fileSize,
        }
        filesBase64[fileHash] = encodeBase64(await Deno.readFile(entry.path))
      }
    }
    const upload_session = await client.workers.scripts.assets.upload.create(
      config.name,
      {
        account_id,
        manifest,
      },
    )

    const buckets = upload_session.buckets ?? []
    let completion_jwt: string | undefined
    if (buckets.length != 0) {
      for (const bucket of buckets) {
        const assets_session = await client.workers.assets.upload.create(
          {
            account_id,
            base64: true,
            body: Object.fromEntries(
              Object.entries(filesBase64).filter(([hash]) =>
                bucket.includes(hash),
              ),
            ),
          },
          {
            headers: {
              Authorization: `Bearer ${upload_session.jwt}`,
            },
          },
        )
        if (assets_session.jwt) {
          completion_jwt = assets_session.jwt
        }
      }

      if (!completion_jwt) {
        throw new Error('completion jwt not recv')
      }
    }
    // if no asset need to update, completion_jwt will be undefined

    await client.workers.scripts.update(config.name, {
      account_id,
      metadata: {
        main_module: config.main ? 'index.js' : undefined,
        compatibility_date: config.compatibility_date,
        bindings: config.main
          ? [
              ...(config.assets.binding
                ? [
                    {
                      name: config.assets.binding,
                      type: 'assets',
                    } as const,
                  ]
                : []),
            ]
          : undefined,
        assets: {
          config: {
            _headers: config.assets._headers,
            _redirects: config.assets._redirects,
            html_handling: config.assets.html_handling,
            not_found_handling: config.assets.not_found_handling,
            run_worker_first: config.assets.run_worker_first,
            serve_directly: config.assets.serve_directly,
          },
          jwt: completion_jwt,
        },
        keep_assets: !completion_jwt,
      },
      files: {
        'index.js': await (async () => {
          const content = config.main
            ? await Deno.readFile(config.main!)
            : undefined
          return new File(content ? [content] : [], 'index.js', {
            type: 'application/javascript+module',
          })
        })(),
      },
    })
  } else if (config.main) {
    const main = config.main
    await client.workers.scripts.update(config.name, {
      account_id,
      metadata: {
        main_module: 'index.js',
        compatibility_date: config.compatibility_date,
      },
      files: {
        'index.js': await (async () => {
          const content = await Deno.readFile(main)
          return new File([content], 'index.js', {
            type: 'application/javascript+module',
          })
        })(),
      },
    })
  }
}
