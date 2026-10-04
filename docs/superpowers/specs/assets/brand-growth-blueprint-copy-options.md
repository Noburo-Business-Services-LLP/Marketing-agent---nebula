# Brand Growth Blueprint: copy options

Three options for the ad and the landing section. Each follows the app voice rules: plain complete sentences, no exclamation marks, no emoji, no slang, no invented claim, no promise of speed, and no number other than the 100 free Quarks. Each ad headline is at most 40 characters. Option A is the default in the build.

## Option A (default in the build)

- Ad headline: Get your Brand Growth Blueprint, free
- Ad primary text: Answer a few questions about your business. Nebulaa reads the pages you point to and writes a printable 90-day growth plan. Every statement in it is marked as verified or as a suggestion, so you can see what is fact and what is advice.
- Landing headline: A written growth plan for your business, free.
- Landing subline: Tell Nebulaa about your business. You receive a printable Brand Growth Blueprint with what Nebulaa confirmed about your brand, who to speak to, what to post and what to do first.
- Button: Get my free Blueprint
- Note: It uses a small number of your 100 free Quarks.

## Option B

- Ad headline: Your brand, planned for 90 days
- Ad primary text: Share your website and a few details. Nebulaa prepares a Brand Growth Blueprint: your audience, your content themes, a month of post ideas and the first steps to take. It is free to create.
- Landing headline: See your next 90 days of marketing on paper.
- Landing subline: The Blueprint shows what Nebulaa could confirm about your business, then proposes a plan you can print, share with your team or turn into posts.
- Button: Create my Blueprint
- Note: It uses a small number of your 100 free Quarks.

## Option C

- Ad headline: A growth plan that shows its sources
- Ad primary text: Most marketing plans mix facts with guesses. The Nebulaa Brand Growth Blueprint labels each statement as verified, inferred, proposed or unverified. Create yours free.
- Landing headline: A marketing plan that separates facts from suggestions.
- Landing subline: Every statement in your Blueprint is labelled, so you always know what Nebulaa confirmed from your own pages and what it is recommending.
- Button: Get my free Blueprint
- Note: It uses a small number of your 100 free Quarks.

## Recommendation

Option A. It uses the owner's own phrase, a Brand Growth Blueprint, in the ad headline and states plainly what the visitor receives. It also explains the one feature that sets the Blueprint apart, the split between fact and suggestion, without naming internal labels. Option B is the softest and says least about how the plan is made. Option C is the most distinctive, but it leads with a comparison to other marketing plans, which is a claim about others that Nebulaa cannot support.

## Questions the spec left open

1. Which wording goes on the ad and the landing section? Option A is built in as the default. The final choice is the owner's. If another option is chosen, only `frontend/constants/blueprintCopy.ts` changes.
2. Should the free Blueprint include the competitor read when no competitors are given? No. The plan's decision is that the competitor read runs only when the visitor names competitors with an address, and only for pages that allow reading. When none are given, page 3 asks the visitor to add them.

## Related decisions from the plan

- A missing logo does not stop the run. The Blueprint shows the business name in plain type with the note "Logo not provided".
- A website that does not appear to mention the business name does not stop the run. The Blueprint shows a visible warning that the name and the address may not belong together.
