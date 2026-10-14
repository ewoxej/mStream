# mstream-zenelo image

The Zenelo fork of mStream as a container: `ghcr.io/ewoxej/mstream-zenelo`
(linux/amd64, linux/arm64). Built from the `Dockerfile` at the repo root.

## Run

```sh
docker run -d --name mstream -p 3000:3000 \
  -v mstream-config:/config \
  -v /path/to/music:/music:ro \
  ghcr.io/ewoxej/mstream-zenelo:latest
```

or with Compose:

```yaml
services:
  mstream:
    image: ghcr.io/ewoxej/mstream-zenelo:latest
    ports: ["3000:3000"]
    volumes:
      - ./config:/config
      - /path/to/music:/music:ro
    restart: unless-stopped
```

Then open `http://<host>:3000/admin` and add a user (until there is one, the
server has no login).

- `/config` — config, database, covers, logs, and the ffmpeg mStream
  downloads on first use. A first `config.json` is written when there is none
  (library `music` at `/music`); after that edit it or use the admin panel.
- The server runs as the image's `node` user (uid 1000). A bind-mounted
  `/config` must be writable by it: `sudo chown -R 1000:1000 ./config`.
- More libraries: mount them (`/path/to/podcasts:/podcasts:ro`) and add them
  in the admin panel (Directories).
- Server audio (playing on the host's speakers) doesn't work in a container.

## Tags

| Tag | What |
| --- | --- |
| `latest`, `1.2`, `1.2.3` | releases (Docker release workflow) |
| `edge` | the last manual Docker build of `master` |
| `sha-<commit>` | every build of `master` |

## Versioning

The image version is the `VERSION` file at the repo root, independent of
upstream mStream's `package.json` version (the release notes and the
`io.mstream.upstream-version` label name the upstream it's based on).
To release: bump `VERSION`, commit, then run **Actions → Docker release**. It
runs the unit tests, pushes the version tags, tags the commit
`zenelo-v<version>` and publishes a GitHub release; it refuses a version that
was already released.
