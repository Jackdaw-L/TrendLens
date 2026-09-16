-- Apply after the workflows are deployed and the Vault credential is configured.
-- All schedules use UTC; local times below are Asia/Shanghai.
select cron.schedule('trendlens-daily-0700', '0 23 * * *', $$select trendlens_internal.dispatch_job('daily');$$);
select cron.schedule('trendlens-daily-check-0800', '0 0 * * *', $$select trendlens_internal.dispatch_job('daily', true);$$);
select cron.schedule('trendlens-daily-check-0830', '30 0 * * *', $$select trendlens_internal.dispatch_job('daily', true, false);$$);
select cron.schedule('trendlens-daily-retry-1205', '5 4 * * *', $$select trendlens_internal.dispatch_job('daily', true);$$);
select cron.schedule('trendlens-daily-check-1235', '35 4 * * *', $$select trendlens_internal.dispatch_job('daily', true, false);$$);
select cron.schedule('trendlens-weekly-2107', '7 13 * * 0', $$select trendlens_internal.dispatch_job('weekly');$$);
select cron.schedule('trendlens-weekly-check-2137', '37 13 * * 0', $$select trendlens_internal.dispatch_job('weekly', true);$$);
select cron.schedule('trendlens-weekly-check-2217', '17 14 * * 0', $$select trendlens_internal.dispatch_job('weekly', true);$$);
select cron.schedule('trendlens-weekly-check-2247', '47 14 * * 0', $$select trendlens_internal.dispatch_job('weekly', true, false);$$);
