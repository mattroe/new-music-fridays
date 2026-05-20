---
name: new-music-fridays
description: Provide me a new music summary weekly based on my listening history
---

Today is Friday. Produce my "New Music Friday" summary covering new music released today or in the last calendar week (the past 7 days).

Data gathering (call these in parallel):

mcp__Last-fm__lastfm_auth_status — confirm auth.
mcp__Last-fm__get_top_artists with period="3month", limit=50
mcp__Last-fm__get_top_artists with period="12month", limit=50
mcp__Last-fm__get_top_artists with period="overall", limit=100
mcp__Last-fm__get_music_recommendations with limit=50 (Use this to seed discovery picks, alongside the listening history above.)
For the top 20 artists from the 3-month chart and overall chart, also call mcp__Last-fm__get_similar_artists (limit=50) to widen the discovery pool.

New release research:
Search the web for albums released in the past 7 days across the genres in my listening profile (ECM/contemporary jazz, ambient, indie folk, experimental hip-hop, world/folk, modern composition, indie rock). Draw from a broad range of sources including: NPR Music New Music Friday, Bandcamp Daily Essential Releases, Pitchfork Best New Music, Paste Magazine, Stereogum, Resident Advisor, The Wire, Jazzwise, Presto Music jazz roundup, AllMusic, Qobuz (albums of the week, Qobuzissme, etc.) and any genre-specific blogs or label sites relevant to that week's releases. Cross-reference everything against the listening data AND the get_music_recommendations output before including it.

Output — clearly-separated sections, in this order:

Top 5 Picks of the Week — lead with this. Five releases across both known and discovery artists, sorted by tightness of fit to my tastes. One sentence each on why.

A) Artists I've already listened to — artists appearing in any of my top-artist charts or loved tracks. For each: album title, label, release date, why it's relevant (which charts they appear on, play count if notable, producer/collaborator overlap with other artists I listen to). Sort by tightness of fit.

B) Discovery picks — maximum 5. Artists NOT in my listening history, matched via: (i) get_music_recommendations output, (ii) similar-artist overlap with my top artists, or (iii) genre/label/collaborator overlap. For each: album title, label, release date, one-line "why this fits" tied to a specific artist or genre from my profile. Sort by tightness of fit.

Skip / low priority — brief list of major releases that week that don't fit my taste, so I know what I'm consciously passing on.

Write the complete summary as an email using the `resend` connector. Send **to**: you@example.com. Send **from**: digest@example.com — pass this address as a plain email string with no display-name wrapper (the `from` field does not accept "Name <email>" format). Subject line: "New Music Friday - MM-DD-YYYY" where the date field is actually today's date.