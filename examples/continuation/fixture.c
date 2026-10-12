/* Real freestanding C continuation probe. No filesystem or network calls. */
#include <stdint.h>

__attribute__((import_module("env"), import_name("pre_cut")))
extern void pre_cut(int32_t stage, uint32_t value);
__attribute__((import_module("env"), import_name("pending_effect")))
extern int32_t pending_effect(uint32_t kind, uint32_t request, uint32_t ptr, uint32_t words);
__attribute__((import_module("env"), import_name("post_cut")))
extern void post_cut(int32_t stage, uint32_t value);

static uint32_t arena[128];
static uint32_t allocated;
static uint32_t global_total = 100;
static uint32_t entry_count;
static uint32_t asyncify_storage[4098];

static uint32_t *allocate(uint32_t words) {
    if (allocated + words > 128) __builtin_trap();
    uint32_t *result = arena + allocated;
    allocated += words;
    return result;
}

__attribute__((noinline))
static uint32_t deep(uint32_t *heap, uint32_t base) {
    /* Actual automatic stack storage plus a live Wasm local across the cut. */
    volatile uint32_t automatic[3];
    automatic[0] = base + 17;
    automatic[1] = base ^ 0x2468ace0u;
    automatic[2] = automatic[0] + automatic[1];
    uint32_t live_local = base * 13u + 29u;
    heap[2] = automatic[0] ^ automatic[1];
    global_total += 23;
    pre_cut(3, automatic[2]);
    int32_t response = pending_effect(73, base, (uint32_t)(uintptr_t)heap, 4);
    uint32_t suffix = (uint32_t)response * 5u + automatic[2] + live_local;
    heap[1] ^= (uint32_t)response;
    heap[3] += suffix;
    global_total ^= suffix;
    post_cut(3, suffix);
    return suffix + automatic[0] + heap[0];
}

__attribute__((noinline))
static uint32_t middle(uint32_t seed, uint32_t *heap, uint32_t root_local) {
    uint32_t live_local = seed ^ 0x13579bdfu;
    pre_cut(2, live_local);
    uint32_t nested = deep(heap, live_local + root_local);
    post_cut(2, nested);
    return nested + live_local + heap[1];
}

__attribute__((export_name("run"), noinline))
uint32_t run(uint32_t seed) {
    ++entry_count;
    uint32_t *heap = allocate(4);
    heap[0] = seed + 7;
    heap[1] = 42;
    heap[2] = 0;
    heap[3] = seed ^ global_total;
    global_total += seed;
    uint32_t root_local = seed * 17u + 19u;
    pre_cut(1, entry_count);
    uint32_t nested = middle(seed, heap, root_local);
    global_total += nested;
    post_cut(1, global_total);
    return root_local + nested + global_total;
}

__attribute__((export_name("header_address")))
uint32_t header_address(void) { return (uint32_t)(uintptr_t)asyncify_storage; }
__attribute__((export_name("asyncify_capacity")))
uint32_t asyncify_capacity(void) { return sizeof(asyncify_storage); }
__attribute__((export_name("arena_address")))
uint32_t arena_address(void) { return (uint32_t)(uintptr_t)arena; }
__attribute__((export_name("allocated_words")))
uint32_t allocated_words(void) { return allocated; }
__attribute__((export_name("global_value")))
uint32_t global_value(void) { return global_total; }
__attribute__((export_name("entry_count")))
uint32_t entries(void) { return entry_count; }
