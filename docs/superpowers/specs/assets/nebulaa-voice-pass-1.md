# Nebulaa app voice, pass 1: before and after

Branch `nebulaa-redesign`. Display text only; keys, routes, values the code compares, API fields and logic are unchanged. Each table lists every changed string, in file order. `{n}`, `{platform}` and similar mark dynamic values.


## components/Layout.tsx (22 strings)

| Before | After |
|---|---|
| Create | Create content |
| Approve | Review and approve |
| Idea Inbox | Content ideas |
| Upload & Schedule | Upload and schedule |
| Insights | Performance |
| Brand Assets | Brand assets |
| Connect Socials | Connected accounts |
| AI Memory | Brand memory |
| Top bar: Create | Top bar: Create content |
| Top bar: Connect Socials | Top bar: Connected accounts |
| Top bar: Brand Assets | Top bar: Brand assets |
| Top bar: Brand Assets / Products & Services | Top bar: Brand assets / Products and services |
| Top bar: Insights | Top bar: Performance |
| Top bar: AI Memory | Top bar: Brand memory |
| Top bar: Approve | Top bar: Review and approve |
| Top bar: Idea Inbox | Top bar: Content ideas |
| Top bar: Upload & Schedule | Top bar: Upload and schedule |
| Usage Overview | Usage overview |
| Free Trial (badge) | Free trial (badge) |
| used all-time | used in total |
| What does each action cost? | See what each action costs. |
| See in Settings → | View in Settings → |

## pages/GravityHome.tsx (13 strings)

| Before | After |
|---|---|
| Connect your social accounts and confirm brand voice — 2 minutes. | Connect your social media accounts and confirm your brand voice. This takes about two minutes. |
| <span>0 of 2 done</span> | <span>0 of 2 steps done</span> |
| {n} posts are ready for your eye. (0 posts are ready for your eye.) | {n} posts are waiting for your review. (No posts are waiting for your review.) |
| Nebulaa drafted the week ahead while you slept. Take a minute, tap through, and we'll handle the rest — scheduled, posted, measured. | Nebulaa prepares your content for the week ahead. Review each post, approve the ones you want, and Nebulaa schedules and publishes them for you. |
| Start fresh (button) | Create content (button) |
| Today's Plan | Today's plan |
| Nothing on the schedule for today. Enjoy a slower day. | No posts are scheduled for today. Open the calendar to schedule one. |
| Open Calendar → | Open calendar → |
| This Week | This week |
| vs. last 7d | Compared with the last 7 days |
| across {platforms} | Published across {platforms} |
| No platforms connected yet | No platforms are connected yet. |
| No platforms set | No platforms are set |

## pages/GravityCreate.tsx (55 strings)

| Before | After |
|---|---|
| Could not publish this post | This post could not be published. |
| No caption came back | No caption was returned. Please try again. |
| Could not write a caption | A caption could not be written. |
| Could not save the caption | The caption could not be saved. |
| Could not regenerate | The image could not be regenerated. |
| Could not apply that edit | That edit could not be applied. |
| {n} of {m} could not be sent. | {n} of {m} posts could not be published. |
| Pick a date and time first | Choose a date and time first. |
| Could not schedule this post | This post could not be scheduled. |
| Queuing the poster… | Starting image generation… |
| Failed to generate LinkedIn post. | The LinkedIn post could not be generated. |
| Post generated but couldn't be saved — copy it before retrying: {caption} | The post was generated but could not be saved. Copy it before you try again: {caption} |
| Planning the story… | Planning the carousel… |
| Rendering… | Generating the images… |
| Generation failed | Generation failed. Please try again. |
| Server responded {status} | The server returned an error ({status}). |
| No response body from server. | The server did not send a response. |
| Generation ended without any slides. | Generation finished without creating any slides. |
| Generation ended without any posts. | Generation finished without creating any posts. |
| Warming up the studio… | Starting campaign generation… |
| Drafting… (progress fallback) | Generating the posts… |
| Drafted {n} post(s)… | {n} post(s) created so far… |
| Loading what was drafted… | Loading your new posts… |
| Give it a name first. | Enter a name first. |
| Pick at least one platform. | Choose at least one platform. |
| Failed to draft. Try again. | The content could not be created. Please try again. |
| Draft a post · one shot | Create a single post |
| What are we working on? | Describe your campaign |
| What's the story? | Describe your carousel |
| What's on your mind? | Describe your post |
| Describe the campaign once. Nebulaa drafts the full run — across platforms, spaced out, in your voice. | Describe the campaign once. Nebulaa creates the full set of posts for the platforms you choose, spaced out over the duration you set, in your brand voice. |
| One idea, told across slides. Nebulaa plans the arc, then renders every slide in the same look. | Describe one idea. Nebulaa plans how it unfolds across the slides, then generates every slide with the same look. |
| One sentence is enough. Nebulaa turns it into a scroll-stopping post. | One sentence is enough. Nebulaa turns it into a finished post. |
| Pull an idea from your calendar | Choose an idea from your calendar |
| e.g. Launch our monsoon menu over two weeks — tease, reveal, drive footfall to the Saturday launch event. | For example: Launch our monsoon menu over two weeks. Introduce the dishes first, then reveal the menu, then invite customers to the Saturday launch event. |
| We just crossed 500 customers — what that actually took | For example: We have reached 500 customers. Here is what it took to get there. |
| e.g. Slow Sunday. Filter coffee, one hand pouring, room quiet — invite people to spend the morning with us. | For example: A quiet Sunday morning with filter coffee. Invite people to spend the morning with us. |
| Visual Style | Visual style |
| · none in Brand Assets | · none in Brand assets |
| Drafting… (button) | Creating… (button) |
| Draft my campaign / Build my carousel / Draft this post | Create campaign / Create carousel / Create post |
| Drafting your post | Creating your post |
| Making something good. (heading) | Your content is being created. |
| Making something good. (results heading) | Your content is being created. |
| {n} of {m} ready… | {n} of {m} created |
| {n} posts · your campaign | {n} posts in your campaign |
| {n} slides · swipe in order | {n} slides, in swipe order |
| Still rendering — this updates on its own. | Some images are still being generated. This page updates automatically. |
| Image failed | Image generation failed |
| See the prompt | View the prompt |
| Regenerating costs credits. | Regenerating costs Quarks. |
| e.g. fix the spelling in the headline, make the sky darker, remove the coffee cup | For example: fix the spelling in the headline, make the sky darker, or remove the coffee cup. |
| Keeps the rest of the image as-is. | The rest of the image stays the same. |
| Wait for the artwork (tooltip) | Wait until the image is ready (tooltip) |
| Draft (button) | Save as draft (button) |

## pages/GravityApprove.tsx (26 strings)

| Before | After |
|---|---|
| That did not work | Something went wrong. Please try again. |
| Failed to load drafts | The drafts could not be loaded. |
| Failed to approve | The post could not be approved. |
| Failed to regenerate. | The image could not be regenerated. |
| Could not apply that edit. | That edit could not be applied. |
| Approve (eyebrow) | Review and approve (eyebrow) |
| Give everything the once-over | Review your posts before they are published |
| Review what Nebulaa drafted, approve what's ready, and send back what needs work. | Review the posts Nebulaa prepared, approve the ones that are ready, and regenerate the ones that need changes. |
| No {tab} posts yet. (e.g. "No all posts yet.") | No posts are listed under "{tab}" yet. |
| Nothing here | No posts to show |
| Loading queue… | Loading posts for review… |
| Nothing to approve | No posts to review |
| You're all caught up. | No posts are waiting for your review. |
| When Nebulaa drafts new posts, they'll wait here for your approval. | New posts that Nebulaa prepares will appear here for your approval. |
| Draft something new (button) | Create content (button) |
| Approve & schedule (tooltip) | Approve and schedule (tooltip) |
| Approve & schedule (button) | Approve and schedule (button) |
| Something went wrong. Click Regenerate to try again. | Something went wrong. Select Regenerate to try again. |
| This post doesn't have an image. Click Add image to generate one. | This post does not have an image. Select Add image to generate one. |
| generating… | Generating… |
| The image is being drafted. This usually takes 20–40 seconds. | The image is being generated. This usually takes 20 to 40 seconds. |
| No resolved prompt was recorded for this image. Leave blank to let the Creative Director choose a fresh concept, or write one to use exactly. | No prompt was recorded for this image. Leave this blank and Nebulaa will choose a new concept, or write your own prompt to use it exactly. |
| Edited — Regenerate will use this exact text. | You edited the prompt. Regenerate will use this exact text. |
| Empty — Regenerate will ask the Creative Director for a new concept. | The prompt is empty. Regenerate will ask Nebulaa for a new concept. |
| e.g. fix the spelling in the headline, make the sky darker, remove the coffee cup | For example: fix the spelling in the headline, make the sky darker, or remove the coffee cup. |
| Keeps the rest of the image as-is. | The rest of the image stays the same. |

## pages/GravityInsights.tsx (12 strings)

| Before | After |
|---|---|
| You reached {N} people without lifting a finger. | Your posts reached {N} people. |
| {Up\|Down} X% week-over-week. Keep the cadence Nebulaa set for you. | Reach is {up\|down} X% compared with the previous 7 days. Keep publishing on the schedule Nebulaa set for you. |
| Once your posts go live, this is where you'll see how many people saw them — no dashboards to build, no spreadsheets to open. | After your posts are published, this page shows how many people saw them. You do not need to build a dashboard or open a spreadsheet. |
| vs. last 7 days | Compared with the previous 7 days |
| Reach (7d) | Reach (7 days) |
| New Followers | New followers |
| Approval Rate | Approval rate |
| Reach · Last 14 Days | Reach in the last 14 days |
| ↑ trending / awaiting data | Trending up / Waiting for data |
| Top Posts | Top posts |
| No posts yet. Once you publish, your best-performing posts will show up here. | No posts have been published yet. Your best-performing posts will appear here after you publish. |
| Loading insights… | Loading performance data… |

## pages/IdeaInbox.tsx (29 strings)

| Before | After |
|---|---|
| Could not read file | The file could not be read. |
| Failed to load ideas | The ideas could not be loaded. |
| Could not read image | The image could not be read. |
| Write the idea first | Enter an idea before you add it. |
| Failed to save idea (thrown) | The idea could not be saved. |
| Failed to save idea | The idea could not be saved. |
| Idea added | The idea was added. |
| Added {n} idea(s) | {n} idea was added. / {n} ideas were added. |
| Import failed (thrown) | The import failed. |
| Import failed | The import failed. |
| No text found in the first column of that file | No text was found in the first column of that file. |
| Added {n} idea(s) from {file} | {n} idea(s) from {file} was/were added. |
| Could not read that file | That file could not be read. |
| Failed to dismiss | The idea could not be dismissed. |
| This can't be undone. (confirm text) | This idea will be deleted permanently. This cannot be undone. |
| Failed to delete | The idea could not be deleted. |
| Failed to start generation | Post generation could not be started. |
| Turned into a post — check Approve once it's ready | The idea is now a post. It will appear in Review and approve when it is ready. |
| Failed to turn this into a post | This idea could not be turned into a post. |
| Idea Inbox (eyebrow) | Content ideas (eyebrow) |
| Ideas that didn't come from Nebulaa | Save ideas for future posts |
| Drop a thought, a link, an ad you liked — or paste a whole list. Turn any of them into a real post whenever you're ready. | Add a thought, a link or an ad you liked, or paste a list of ideas. You can turn any idea into a post when you are ready. |
| Saw a great ad about founder burnout — want something like that but for our onboarding flow... | For example: Create a post like the ad I saw about founder burnout, but for our onboarding flow. |
| Have a list already? | Import a list of ideas |
| Paste rows, or upload a spreadsheet — one idea per row, first column. | Paste rows or upload a spreadsheet. Use one idea per row, in the first column. |
| One idea per line — / ... Compare us to spreadsheets, funny angle | Enter one idea per line, for example: / ... A comparison of our service with spreadsheets |
| Nothing in the inbox yet. | No ideas have been added yet. |
| Ideas you drop above will sit here until you turn them into a post. | Ideas you add above will appear here until you turn them into posts. |
| Dismiss — keeps it, just out of the way | Dismiss this idea. It is kept but removed from this list. |

## pages/UploadAndSchedule.tsx (19 strings)

| Before | After |
|---|---|
| Pick an image or a video. | Choose an image or a video. |
| That file is over 120MB. | That file is larger than 120MB. Choose a smaller file. |
| Choose a file first | Choose a file first. |
| Upload did not return a draft | The upload did not create a draft. |
| That did not work | Something went wrong. Please try again. |
| No caption came back | No caption was returned. Please try again. |
| Caption written. | The caption was written. |
| Saved to Drafts. | The post was saved to your drafts. |
| Pick a date and time | Choose a date and time. |
| Scheduled. (message) | The post was scheduled. |
| Pick at least one platform | Choose at least one platform. |
| Published. (message) | The post was published. |
| Upload · your own media | Upload and schedule |
| Already have something? | Upload your own photo or video |
| Drop in a photo or a video. Nebulaa writes the caption and puts it out. | Upload a photo or a video. Nebulaa can write the caption, and you can publish the post now or schedule it for later. |
| Drop a file, or click to choose | Drag a file here, or click to choose one |
| Images and video · up to 120MB | Images and videos up to 120MB |
| Give it a name… | Enter a title |
| Write it, or let Nebulaa. | Write a caption, or use the button below to have Nebulaa write one. |

## pages/AIMemory.tsx (6 strings)

| Before | After |
|---|---|
| AI Memory (eyebrow) | Brand memory (eyebrow) |
| A small, curated set of patterns learned from your real published-post performance — not a raw log. | Nebulaa keeps a short list of patterns it has learned from how your published posts performed. |
| Could not save the note. Please try again. | The note could not be saved. Please try again. |
| Could not delete the note. Please try again. | The note could not be deleted. Please try again. |
| Could not refresh. | The notes could not be refreshed. Please try again. |
| Nothing learned yet — this fills in once enough published posts have been tracked for at least a few days. Try "Refresh now" after some posts have been live for a while. | Nothing has been learned yet. Patterns appear here after your published posts have been tracked for at least a few days. After some posts have been live for a while, select "Refresh now" to update this list. |

## pages/HeroVideo.tsx (10 strings)

| Before | After |
|---|---|
| Let's go back to Reels | We could not load this story |
| More unlock on {date}. | More will be available on {date}. |
| Brand Assets (link) | Brand assets (link) |
| Burn the spoken lines into the video. | Add the spoken lines to the video as on-screen text. |
| Could not build a prompt. Please try again. | The prompt could not be built. Please try again. |
| Could not start your Hero video. | Your Hero video could not be started. |
| Could not start your Hero video. Please try again. | Your Hero video could not be started. Please try again. |
| e.g. Book a free consultation | For example: Book a free consultation |
| A Hero video is one premium 15-second clip made from | A Hero video is one 15-second clip made from |
| One premium 15-second clip, cut from your story | One 15-second clip, cut from your story |

## pages/ConnectSocials.tsx (47 strings)

| Before | After |
|---|---|
| {platform} connected successfully! | {platform} was connected successfully. |
| (Popup) This window will redirect to the secure auth flow in a moment. | (Popup) This window will redirect to the secure authorization page shortly. |
| Your browser blocked the {platform} auth window. Click "Open Auth Page" to launch it in a new tab. | Your browser blocked the {platform} authorization window. Select "Open authorization page" to open it in a new tab. |
| Could not open the {platform} auth window automatically. Click "Open Auth Page" to continue. | The {platform} authorization window could not be opened automatically. Select "Open authorization page" to continue. |
| (Popup title) {platform} Connected ✅ | (Popup title) {platform} connected |
| (Popup) ✅ icon | (Popup) icon removed |
| (Popup) {platform} Connected Successfully! | (Popup) {platform} was connected successfully. |
| (Popup) Closing this window... | (Popup) This window will close automatically. |
| Failed to connect account. | The account could not be connected. |
| You denied access to your account. | Access to your account was denied. |
| No YouTube channel found for this Google account. | No YouTube channel was found for this Google account. |
| Failed to authenticate. Please try again. | Authentication failed. Please try again. |
| Authentication session expired. Please try again. | The authentication session expired. Please try again. |
| Could not load social connection status. Please try again in a moment. | The connection status could not be loaded. Please try again in a moment. |
| Failed to initiate {platform} connection. | The {platform} connection could not be started. |
| Failed to connect to {platform}. | Nebulaa could not connect to {platform}. |
| {platform} disconnected successfully. | {platform} was disconnected. |
| Failed to disconnect {platform}. | {platform} could not be disconnected. |
| Tab: Sync Status | Tab: Sync status |
| Tab: Social Inbox | Tab: Social inbox |
| Tab: AI Auto Reply | Tab: Automatic replies |
| Your browser blocked the automatic redirect to Ayrshare. | Your browser blocked the automatic redirect to the authorization page. |
| Open Auth Page (button) | Open authorization page (button) |
| Connect Socials (eyebrow) | Connected accounts (eyebrow) |
| Where should Nebulaa publish? | Connect your social accounts |
| Securely connect your platforms to enable auto-posting and analytics. | Connect your social media accounts securely so that Nebulaa can publish posts for you and report how they perform. |
| Refresh Status | Refresh status |
| Real OAuth (badge) | OAuth sign-in (badge) |
| Unlink (button) | Disconnect (button) |
| Social Inbox (heading) | Social inbox (heading) |
| Open Unified Social Inbox | Open social inbox |
| Inbox Status | Inbox status |
| Connected Platforms | Connected platforms |
| Unread Messages | Unread messages |
| Draft fast, on-brand responses for conversations. | Nebulaa drafts on-brand replies for your conversations. |
| Never miss engagement that needs a response. | Receive an alert when engagement needs a response. |
| Platform Indicators | Platform status |
| OAuth Authentication | OAuth authentication |
| Webhook Registration | Webhook registration |
| Reply Access | Reply access |
| Analytics Read Access | Analytics read access |
| Sync Status (heading) | Sync status (heading) |
| Next Sync | Next sync |
| Unified Social Inbox (heading) | Social inbox (heading) |
| Social Inbox is disabled | Social inbox is disabled |
| Connect Accounts (button) | Connect accounts (button) |
| Successfully Connected! | Connected successfully. |

## pages/Settings.tsx (27 strings)

| Before | After |
|---|---|
| Failed to save business profile | The business profile could not be saved. |
| Failed to generate content strategy | The content strategy could not be generated. |
| Error generating PDF: {message} | The PDF could not be generated: {message} |
| Failed to save changes | Your changes could not be saved. |
| Password changed successfully! | Your password was changed successfully. |
| Failed to change password | Your password could not be changed. |
| Your account, your rules | Manage your account |
| Profile, business details, notifications, security and billing. | Manage your profile, business details, notifications, security and billing in one place. |
| Tab: Business Profile | Tab: Business profile |
| Profile Settings | Profile settings |
| Saved Successfully | Changes saved |
| Save Failed | Save failed |
| Save Changes | Save changes |
| Business Profile (heading) | Business profile (heading) |
| All answers from your onboarding questionnaire. Edit any field and click Save. | These are the answers you gave during onboarding. Edit any field, then select Save business profile. |
| Applies to next month's plan onward — the current month stays as already generated. | Changes apply from next month's plan onward. The current month's plan stays as it was generated. |
| e.g. Professional, Witty | For example: Professional, Witty |
| Anything we should avoid? | Describe anything Nebulaa should avoid. |
| Save Business Profile | Save business profile |
| Change Password (heading) | Change password (heading) |
| Changing Password... | Changing password... |
| Change Password (button) | Change password (button) |
| Advanced notification settings coming soon. | Advanced notification settings are not available yet. |
| Billing & Invoices | Billing and invoices |
| 🔍 Competitor Intel is free. | Competitor Intel is free. |
| No payments yet. | No payments have been made yet. |
| Could not load billing data. Try again later. | Billing data could not be loaded. Please try again later. |

## pages/BrandAssets.tsx (27 strings)

| Before | After |
|---|---|
| Failed to load brand data | Brand data could not be loaded. |
| Logo must be less than 10MB | The logo must be smaller than 10MB. |
| Failed to read logo | The logo could not be read. |
| Logo upload failed | The logo could not be uploaded. |
| Failed to set primary logo | The primary logo could not be set. |
| Failed to delete logo | The logo could not be deleted. |
| Failed to update logo position | The logo position could not be updated. |
| Failed to save brand profile | The brand profile could not be saved. |
| Failed to analyze brand profile | The brand profile could not be analyzed. |
| Past post image must be less than 10MB | The past post image must be smaller than 10MB. |
| Failed to read past post image | The past post image could not be read. |
| Add a caption or image sample | Add a caption or an image sample. |
| Failed to add past post | The past post could not be added. |
| Failed to delete sample | The sample could not be deleted. |
| Brand Assets (eyebrow) | Brand assets (eyebrow) |
| Teach Nebulaa your look | Set up your brand identity |
| Save your brand identity once and auto-apply it in every campaign. | Save your brand identity once, and Nebulaa applies it automatically to every campaign. |
| Tab: Products & Services | Tab: Products and services |
| Brand Logos | Brand logos |
| Brand Profile | Brand profile |
| Save Profile | Save profile |
| Applied Campaign Identity | Applied campaign identity |
| Profile Overrides | Profile overrides |
| Detected Pattern Summary | Detected pattern summary |
| Teach Nebulaa your voice | Add samples of your brand voice |
| Add past posts to teach your preferred message format, CTA flow, and visual structure. | Add past posts so that Nebulaa can learn your preferred message format, call-to-action flow and visual structure. |
| Campaign generation is currently in fallback mode. Add brand assets or past posts to enforce a consistent on-brand style. | Nebulaa does not have your brand details yet, so it is using general defaults for campaigns. Add brand assets or past posts so that every campaign follows your brand style. |

**Total: 293 string entries across 12 files.** Shared strings in `components/gravity/index.tsx` and `pages/CalendarHome.tsx` and `pages/GravityCalendar.tsx` were already plain and are unchanged.
