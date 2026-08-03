# Radio tracks

Out of the box the radio TUNES INTO THE REFERENCE STATION — it streams the
reference deployment's playlist remotely (override or disable with
RADIO_SOURCE_URL; the files themselves are licensed and don't ship in the kit).

To run your own station instead, drop audio files (mp3/m4a/wav/flac…) in this
folder — subfolders become stations, `npm run build` indexes them, and local
tracks always take precedence over the remote source. Stream stations play
regardless.
