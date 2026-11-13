# Project card work progress

The overview retains feature progress and independently displays task and issue progress on every project card. These figures describe recorded work, not deployment or CI status.

- Tasks: done / all tasks; also show todo, in-progress and blocked counts.
- Issues: (resolved + closed) / all issues; also show open and in-progress counts. The label explicitly includes closed issues, which need not be resolved fixes.
- Counts use only records belonging to the card's project. They are recalculated from each loaded snapshot; pending proposals do not change counts until applied.
- Empty categories show `暂无任务` or `暂无问题`, rather than a misleading completed progress bar.

Verification includes isolated status/isolation unit tests and a browser regression for multiple projects, refreshed status, empty states and narrow layout. Browser verification runs in GitHub Actions; no production deployment is implied.
