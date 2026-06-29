---
name: Orval mutation hook call pattern
description: How to call orval-generated React Query mutation and query hooks — the {data: T} wrapper and queryKey requirement.
---

## Rules

### 1. Mutation hooks require {data: T} wrapper
Orval wraps mutation bodies in a `{data: BodyType<T>}` object. Do NOT pass the body directly:

```typescript
// WRONG
await createVendor.mutateAsync({ vendorCode: "V-001", vendorName: "Acme" });

// RIGHT
await createVendor.mutateAsync({ data: { vendorCode: "V-001", vendorName: "Acme" } });
```

**Why:** The generated mutationFn signature is `(variables: {data: BodyType<Input>}) => Promise<Output>`. This is an orval code-generation convention (not React Query's native API).

### 2. useQuery hooks require explicit queryKey when passing options
In the projects using React Query v5 + orval, `UseQueryOptions` has `queryKey` as required. When passing `{ query: { enabled: ... } }`, include the key:

```typescript
// WRONG — TS error: queryKey missing
useGetVendor(id, { query: { enabled: !!id } });

// RIGHT — import the key helper and pass it
import { getGetVendorQueryKey } from "@workspace/api-client-react";
useGetVendor(id, { query: { enabled: !!id, queryKey: getGetVendorQueryKey(id) } });
```

**How to apply:** Every time a query hook needs a conditional `enabled` flag, import its corresponding `getXxxQueryKey` helper from the same package and pass it alongside `enabled`.

### 3. useGetXxx return type is the generated response type
Don't use `ReturnType<typeof useGetXxx>["data"]` to infer types — TypeScript can't resolve generics this way and falls back to `{}`. Import the concrete response type directly:

```typescript
import type { Vendor } from "@workspace/api-client-react";
function buildForm(v: Vendor) { ... }   // ✅
function buildForm(v: NonNullable<ReturnType<typeof useGetVendor>["data"]>) { ... }  // ❌ → {}
```
