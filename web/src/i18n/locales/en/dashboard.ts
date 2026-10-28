// English overview copy: KPI tiles, needs-attention list, running now, upcoming schedules, recent runs and first-use steps.
export default {
  title: 'Overview',
  actions: { newInstance: 'New instance', newJob: 'New job' },
  kpi: {
    label: 'Key figures',
    running: 'Running now',
    runningSub: '{{real}} real · {{dry}} dry run',
    attentionJobs: 'Jobs needing attention',
    attentionJobsSub_one: 'of {{count}} job',
    attentionJobsSub_other: 'of {{count}} jobs',
    attentionInstances: 'Instances needing attention',
    attentionInstancesSub_one: 'of {{count}} instance',
    attentionInstancesSub_other: 'of {{count}} instances',
    nextFire: 'Next scheduled run',
    nextFireNone: 'No upcoming schedules',
    loadFailed: 'Could not load',
  },
  attention: {
    title: 'Needs attention',
    loading: 'Loading items that need attention…',
    empty: 'All clear',
    emptyDescription:
      'No failed real runs, broken schedules or unhealthy instances.',
    busy: 'This job already has a run in progress.',
    lastTested: 'tested {{time}}',
    neverTested: 'never tested',
  },
  running: {
    title: 'Running now',
    empty: 'Nothing is running',
    queued: 'queued {{time}}',
    elapsed: 'running {{time}}',
    created: 'created {{done}} / {{planned}}',
    transferred: 'transferred {{bytes}}',
    planned: 'plan: create {{creates}} · delete {{deletes}}',
  },
  upcoming: {
    title: 'Upcoming',
    empty: 'No enabled schedules',
  },
  recent: {
    title: 'Recent runs',
    loading: 'Loading recent runs…',
    empty: 'No runs yet',
    emptyDescription:
      'Runs appear here once a job runs manually or on schedule.',
    notStarted: 'Not started',
    columns: {
      job: 'Job',
      status: 'Status',
      type: 'Type',
      trigger: 'Trigger',
      started: 'Started',
      duration: 'Duration',
      result: 'Result',
    },
  },
  onboarding: {
    title: 'Get started',
    description: 'Three steps to your first synchronization.',
    done: 'Done',
    instance: {
      title: 'Add an OpenList instance',
      description: 'Connect the servers you want to copy between.',
    },
    job: {
      title: 'Create a job',
      description:
        'Choose a source folder, one or more targets and a schedule.',
    },
    run: {
      title: 'Run it',
      description: 'Start a dry run first to preview what will change.',
    },
  },
} as const;
