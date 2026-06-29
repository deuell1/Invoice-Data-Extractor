---
name: Drizzle aggregate SQL + enum columns
description: How to safely write aggregate SQL in drizzle routes when columns are pgEnum; and how to handle aggregate result types.
---

## Rules

### 1. Cast pgEnum columns to ::text in raw sql<> templates
When using `sql<T>\`...\`` templates to compare enum columns with string literals, always cast:
```typescript
// WRONG — fails with invalid enum input if literal not in enum OR if future values added
sql<number>`sum(case when ${table.status} = 'EXPORTED' then 1 else 0 end)`

// RIGHT — cast to text first
sql<number>`sum(case when ${table.status}::text = 'EXPORTED' then 1 else 0 end)`
```

**Why:** PG validates enum membership at query time. If even ONE string literal in an IN/= clause is not a current member of the enum, the entire query fails with "invalid input value for enum". Casting to text bypasses enum validation.

### 2. Use sum(case when) instead of count(*) filter(where)::int
`count(*) filter (where col = 'X')::int` has ambiguous PG precedence — the `::int` may apply to the filter predicate, not the aggregate result. Use:
```typescript
sql<number>`sum(case when ${table.status}::text = 'EXCEPTION' then 1 else 0 end)`
```

**Why:** PG grammar: `expr::type` has higher precedence than `filter (where ...)`, so the cast applies to the filter condition rather than the aggregate.

### 3. Always Number()-coerce aggregate results before Zod parsing
PostgreSQL returns bigint (count, sum) and numeric (avg, sum of numeric) as strings in the node-postgres driver. Zod schemas with `z.number()` will reject them.

```typescript
res.json(SomeSchema.parse({
  invoiceCount: Number(agg?.invoiceCount ?? 0),
  totalAmount: Number(agg?.totalAmount ?? 0),
  // ...
}));
```

**How to apply:** Any route that aggregates and then parses with a Zod schema must Number()-coerce each numeric field.

### 4. Check actual DB enum members before using string literals
The DB enum may differ from the TypeScript definition if migrations haven't run. Run:
```sql
select enumlabel from pg_enum e join pg_type t on e.enumtypid = t.oid where t.typname = 'my_enum_type';
```
Before relying on any status value in a sql<> template.
