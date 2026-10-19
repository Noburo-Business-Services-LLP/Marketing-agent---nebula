# Trend sources: options for the owner to choose (2026-10-19)

Owner request: "whatever is trending in the industry or on social media that businesses can copy: a trending meme or topic, a World Cup, a film release, an economic crisis". Nebulaa has **no live trend source** today and nothing is scraped. What exists:

- **From the news calendar** (`backend/config/trendingEvents.js`): a small, versioned list of dated public events with industry tags and a one-line idea each, shown in "Trending for you" (Home and the Competitors page). Only certain dates; the owner adds more (film releases, tournaments) once their dates are officially announced. How to add one is written at the top of the file; `backend/tests/trendingEvents.test.js` checks every entry.
- **The plug-in point** (`backend/services/trends/provider.js`): the contract a live source must keep (its own switch, caps, cache, official API only, wording guard, no tragedies or politics turned into marketing). Not implemented.

## Options (prices are what the providers published when last checked by us; confirm before deciding)

| Source | What it gives | Cost | Terms and legal notes | Fit |
|---|---|---|---|---|
| Google Trends (official API, limited alpha announced in 2025) | Search interest by topic and region, rising searches | Not published; access by application | Official, so allowed within its terms; availability for a small company is uncertain | Best signal for "what people in India search now", if access is granted |
| Google Trends through a search-data reseller (for example SerpApi, DataForSEO) | The same trends data as JSON | Roughly USD 50 to 150 a month for a few thousand lookups | The reseller takes the scraping risk; Google's terms do not allow automated access to the public Trends site, so this sits in a grey area | Quick to build; owner/lawyer should be comfortable with the grey area |
| YouTube Data API, "most popular" chart per country | Trending videos in India by category (music, films, sport, news) | Free within the daily quota (one lookup costs 1 unit of 10,000 a day) | Official API; must follow the YouTube API terms (show attribution, refresh data, no storing beyond 30 days) | Good free signal for films, music and sport moments |
| Wikipedia page views ("most read" per day) | What people are reading about today, worldwide or by language | Free | Open data (CC licences); attribution recommended | Good free signal for big news and culture moments; needs filtering |
| News APIs (for example NewsAPI.org, GNews, NewsData.io) | Headlines by country and category | Free developer tiers are not for production; paid plans roughly USD 50 to 450 a month | Licensed for display of headlines with links; check commercial use per plan | Useful for "economic situation" style topics; needs strong filtering (no tragedies) |
| X (Twitter) API trends | Trending topics by place | Paid tiers start around USD 200 a month; trends may need a higher tier | Official API, strict terms on display | Expensive for what it gives |
| Instagram, TikTok, Reels "trending audio" | What is trending inside the apps | No official public API | Scraping their pages breaks their terms; do not build | Not recommended |
| Manual curation by the team (weekly) | A few hand-picked moments per industry | Staff time | No legal risk | Simple and safe; extend `trendingEvents.js` or a small staff screen |

## Recommendation (default if the owner says nothing)

Keep the curated calendar, and add the two free official sources first (YouTube "most popular" for India and Wikipedia "most read"), each behind its own switch, cached a few hours, filtered by category and passed through `normaliseItems()`; then decide on a paid Google Trends source after seeing whether customers use the ideas. Customer wording never names the provider (the label reads "Trending now").

## What the owner needs to decide

1. Which source (or none) to add, and the monthly budget.
2. Whether a grey-area reseller is acceptable.
3. Who keeps `trendingEvents.js` up to date (film releases and tournaments need a confirmed date and a source each).
