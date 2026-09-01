// A minimal stand-in for the Supabase client, enough to exercise src/lib/api.js.
//
// The real client returns a thenable query builder: every method returns `this`
// and awaiting it runs the query. This mirrors that so the data layer can be
// tested without a database — which is the point, since the bugs worth catching
// here are shape bugs (wrong column, dropped field, unhandled error), not
// network bugs.

export function fakeSupabase({ user = { id: 'user-1' }, responses = {} } = {}) {
  const calls = [];

  function builder(table) {
    const op = { table, op: null, payload: null, filters: [], modifier: null };
    calls.push(op);

    const self = {
      select(cols) { op.select = cols ?? '*'; if (!op.op) op.op = 'select'; return self; },
      insert(payload) { op.op = 'insert'; op.payload = payload; return self; },
      update(payload) { op.op = 'update'; op.payload = payload; return self; },
      upsert(payload, opts) { op.op = 'upsert'; op.payload = payload; op.upsertOptions = opts; return self; },
      delete() { op.op = 'delete'; return self; },
      eq(col, val) { op.filters.push(['eq', col, val]); return self; },
      is(col, val) { op.filters.push(['is', col, val]); return self; },
      not(col, o, val) { op.filters.push(['not', col, o, val]); return self; },
      order(col, o) { op.order = [col, o]; return self; },
      limit(n) { op.limit = n; return self; },
      single() { op.modifier = 'single'; return self; },
      maybeSingle() { op.modifier = 'maybeSingle'; return self; },

      then(resolve, reject) {
        return Promise.resolve()
          .then(() => resolveResponse(responses, op))
          .then(resolve, reject);
      },
    };
    return self;
  }

  return {
    calls,
    lastCall: () => calls[calls.length - 1],
    callsFor: table => calls.filter(c => c.table === table),
    auth: {
      getUser: async () => ({ data: { user } }),
    },
    from: builder,
  };
}

// A response entry may be a value or a function of the recorded operation, and
// may be an array (successive calls to the same table consume it in order) so a
// test can make the first insert fail and the retry succeed.
function resolveResponse(responses, op) {
  let entry = responses[op.table];
  if (Array.isArray(entry) && entry.length && (entry[0]?.data !== undefined || entry[0]?.error !== undefined)) {
    entry = entry.length > 1 ? entry.shift() : entry[0];
  }
  const result = typeof entry === 'function' ? entry(op) : entry;
  if (result === undefined) return { data: op.modifier ? null : [], error: null };
  return { data: null, error: null, ...result };
}

// A Postgres-shaped error, as PostgREST reports it.
export const pgError = (code, message, extra = {}) => ({ code, message, ...extra });
