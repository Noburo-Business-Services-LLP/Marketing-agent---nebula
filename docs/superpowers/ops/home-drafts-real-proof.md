# One real check of the Home drafts (Tamil and Hindi, about USD 0.13)

"Make a post in response" and "Draft a witty comment" are tested with a pretend model. This card runs the **one real run** that proves the writer and the decency check on real models, in Tamil and Hindi, before the feature is switched on.

## What it costs
About **USD 0.13** (about Rs 11), at most about **USD 0.19** if both drafts need their second try. At most 10 model calls; an 11th is blocked. It uses your OpenAI key only for this one command, from a hidden prompt (nothing you type is shown). It does not touch the database, any wallet or any file with keys, and it posts nothing anywhere.

## What it does
With made-up sample data (a Madurai sweet shop and a made-up competitor):
1. A **witty comment in Tamil** and a **post in response in Hindi**, through the real pipeline exactly as customers get it: the real prompts, the local filter, the real writer and the real check, with at most one more try each.
2. Two **deliberately unkind comments** (one Tamil, one Hindi) sent to the check alone. The check must answer "not decent" for both.

## The command
Copy all of this into Terminal and press Enter. Terminal asks for your OpenAI key; what you type is hidden.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && cd "/Users/dineshkannaa/Documents/0 CONTENT/Claude Agents/nebula-worktrees/nebulaa-redesign/backend" && read -rs "KEY?OpenAI key (hidden): " && echo && OPENAI_API_KEY="$KEY" I_APPROVED_HOME_DRAFT_CALLS=yes node scripts/home-drafts-real-proof.js; unset KEY
```

`I_APPROVED_HOME_DRAFT_CALLS=yes` is your approval for these paid calls; without it the script refuses and spends nothing.

## What you will see
- The estimated cost, the writer model and the check model.
- For the Tamil comment and the Hindi post: "shown" or "not shown", how many calls it took, and **the full text** of each draft that passed.
- For the two unkind samples: "not decent" with the check's short reasons.
- A result file in your temporary folder (path printed): the drafts, outcomes and the check's answers, never the key.

## What good looks like
- Both drafts are shown, read naturally in Tamil and Hindi, are kind, never name or compare with anyone, hold no numbers or prices, and fit the length (comment up to 220 characters, caption up to 600 with at most 3 hashtags).
- Both unkind samples are "not decent". If the script prints "WARNING: the check passed an unkind sample", do not switch the feature on; send the output back.
- A draft "not shown" is not a failure by itself (the pipeline refused it and nothing would have been charged), but send the output back so the rules can be tuned.

Send the printed output (or the result file) back. After a good run the feature can be switched on with `ENABLE_COMPETITOR_DRAFTS=on` (see `home-drafts.md`).
