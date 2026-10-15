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
- Binaries mStream fetches on first use (the server-audio engine, yt-dlp)
  are kept in `/config/data`.

## Server speakers

The server can play on the host's sound device: it shows up as **Server
speakers** among the playback devices (the player's devices button, the
Zenelo app) for admins and users allowed server audio. Turn on
**Auto-Boot Server Audio** (admin panel → Settings → Server Audio); the
engine (`mstream-player`) is fetched on first use.

The container needs the host's sound, so only a **Linux host with a sound
device** will do — Docker Desktop on macOS / Windows runs containers in a VM
without one. Two ways in:

**ALSA directly** — a headless box (mini PC, NAS, Raspberry Pi) where
nothing else owns the sound card:

```yaml
services:
  mstream:
    image: ghcr.io/ewoxej/mstream-zenelo:latest
    ports: ["3000:3000"]
    volumes:
      - ./config:/config
      - /path/to/music:/music:ro
    devices:
      - /dev/snd:/dev/snd
    group_add:
      - audio          # or the host's numeric gid: getent group audio
    restart: unless-stopped
```

**PulseAudio / PipeWire** — a desktop host, where the sound server owns the
card (ALSA from the container would find it busy). Mount its socket; the
container's ALSA then plays through it:

```yaml
    volumes:
      - ./config:/config
      - /path/to/music:/music:ro
      - /run/user/1000/pulse:/run/user/1000/pulse   # the host user's runtime dir
    environment:
      PULSE_SERVER: unix:/run/user/1000/pulse/native
```

The container runs as uid 1000: with a host user of another uid, the socket
must be readable for 1000 (or run the container as that uid and keep
`/config` writable for it). PipeWire serves this socket through
`pipewire-pulse`, on by default on current desktops.

If **Server speakers** doesn't appear, the engine didn't start: the server
log says why (Admin → Logs) — e.g. no sound device in the container.

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
