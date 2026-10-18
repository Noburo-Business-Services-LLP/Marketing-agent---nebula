# One real check of the subtitle timing (about one cent)

The new subtitles listen to the finished video once (OpenAI Whisper) to find out **when** the words are spoken, then show our own line at those moments. Everything is already tested with a pretend Whisper. This card runs the **one real call** that proves it on a real video.

## What it costs
About **one cent** (USD 0.006 per minute of audio, so a 30 second video is about USD 0.003). It makes exactly **one** call and never retries. It uses your own OpenAI key only for this one command, from a hidden prompt (nothing you type is shown). It does not touch the database or any file with keys.

## What you need
- A video file on your Mac (any `.mp4` up to 90 seconds with speech, for example one of your Tamil test videos).
- Optional but useful: the exact line that was meant to be spoken, so the check can score how close the heard words are.

## The command
Copy all of this into Terminal, change the video path (and the language and line if you want), and press Enter. Terminal asks for your OpenAI key; what you type is hidden.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && read -rs "KEY?OpenAI key (hidden): " && echo && OPENAI_API_KEY="$KEY" I_APPROVED_ONE_WHISPER_CALL=yes node scripts/subtitle-real-proof.js "/path/to/your-video.mp4" --language ta --line "இன்றே ஆர்டர் செய்யுங்கள். ஆயிரம் ரூபாய்க்கு மேல் வீட்டிலேயே இலவச டெலிவரி."; unset KEY
```

- `--language` is `ta` (Tamil), `hi` (Hindi), `en` (English), `te`, `kn` or `ml`. Leave it out and Whisper decides.
- `--line` is optional. `I_APPROVED_ONE_WHISPER_CALL=yes` is your approval for the one paid call; without it the script refuses and spends nothing.

## What you will see
- The video length and the estimated cost, then one call.
- How many speech pieces Whisper found, and for each: when it starts and ends and only its **first 20 characters**.
- The **speech window**: the time from first word to last word. Subtitles would appear only inside it. Check it against what you hear: does the speech really start and stop there?
- If you gave `--line`: a **similarity score** from 0 to 1 and whether the app would keep the subtitles (the app skips them below 0.3, because wrong words on screen are worse than none).
- A small result file saved in your temporary folder (path printed). It holds times and the first 20 characters of each piece, never the whole transcript.

## What good looks like
The speech window matches what you hear (within about half a second), and the similarity is well above 0.3 when the line was said correctly. Send the printed output (or the result file) back and we will compare it with the video before switching anything on for customers.
