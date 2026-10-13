#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <sys/time.h>
#include <wasi/api.h>
#include "quickjs.h"
#include <stddef.h>
#include <math.h>
__attribute__((import_module("env"),import_name("pre_cut"))) extern void pre_cut(int32_t,uint32_t);
__attribute__((import_module("env"),import_name("pending_effect"))) extern int32_t pending_effect(uint32_t,uint32_t,uint32_t,uint32_t);
__attribute__((import_module("env"),import_name("post_cut"))) extern void post_cut(int32_t,uint32_t);
static uint32_t asyncify_storage[65536];
#define SOURCE_CAPACITY (1024 * 1024)
static struct {
    char begin[32];
    char text[SOURCE_CAPACITY];
    char end[32];
} source_slot = {"FORKWAKE_QJS_SOURCE_BEGIN_V1", "throw Error('script not loaded')", "FORKWAKE_QJS_SOURCE_END_V1"};
#define script source_slot.text
static struct { size_t current, peak, denied, allocations, frees, reallocations, interrupt_calls; } stats;
#define REQUESTED_HEAP_LIMIT (4u * 1024u * 1024u)
#define INTERRUPT_LIMIT 10000u
union align_header { max_align_t alignment; struct { size_t requested; uint32_t magic; } info; };
typedef union align_header Header;
#define HEADER_MAGIC 0x514a5341u
static void *owned_malloc(JSMallocState *state,size_t size) {
    if(!size || stats.current>REQUESTED_HEAP_LIMIT || size>SIZE_MAX-sizeof(Header) || size>REQUESTED_HEAP_LIMIT-stats.current || state->malloc_size>state->malloc_limit || size>state->malloc_limit-state->malloc_size){stats.denied++;return NULL;}
    Header *h=malloc(sizeof(Header)+size);if(!h){stats.denied++;return NULL;}
    h->info.requested=size;h->info.magic=HEADER_MAGIC;state->malloc_count++;state->malloc_size+=size;stats.current+=size;stats.allocations++;if(stats.current>stats.peak)stats.peak=stats.current;return h+1;
}
static size_t owned_size(const void *ptr){if(!ptr)return 0;const Header *h=(const Header*)ptr-1;if(h->info.magic!=HEADER_MAGIC)__builtin_trap();return h->info.requested;}
static void owned_free(JSMallocState *state,void *ptr){if(!ptr)return;size_t n=owned_size(ptr);if(n>stats.current||n>state->malloc_size||!state->malloc_count)__builtin_trap();state->malloc_count--;state->malloc_size-=n;stats.current-=n;stats.frees++;Header *h=(Header*)ptr-1;h->info.magic=0;free(h);}
static void *owned_realloc(JSMallocState *state,void *ptr,size_t size){
    if(!ptr)return size?owned_malloc(state,size):NULL;if(!size){owned_free(state,ptr);return NULL;}
    size_t old=owned_size(ptr);if(old>stats.current||old>state->malloc_size)__builtin_trap();
    size_t guest_base=stats.current-old,state_base=state->malloc_size-old;
    if(size>SIZE_MAX-sizeof(Header)||guest_base>REQUESTED_HEAP_LIMIT||size>REQUESTED_HEAP_LIMIT-guest_base||state_base>state->malloc_limit||size>state->malloc_limit-state_base){stats.denied++;return NULL;}
    Header *h=realloc((Header*)ptr-1,sizeof(Header)+size);if(!h){stats.denied++;return NULL;}h->info.requested=size;h->info.magic=HEADER_MAGIC;state->malloc_size=state_base+size;stats.current=guest_base+size;stats.reallocations++;if(stats.current>stats.peak)stats.peak=stats.current;return h+1;
}
static const JSMallocFunctions owned_allocators={owned_malloc,owned_free,owned_realloc,owned_size};
static int interrupt(JSRuntime *rt,void *opaque){(void)rt;(void)opaque;return ++stats.interrupt_calls>INTERRUPT_LIMIT;}
static JSValue heap_stats(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){
 (void)self;(void)argc;(void)argv;JSValue o=JS_NewObject(ctx);if(JS_IsException(o))return o;
 JS_SetPropertyStr(ctx,o,"current",JS_NewInt64(ctx,stats.current));JS_SetPropertyStr(ctx,o,"peak",JS_NewInt64(ctx,stats.peak));JS_SetPropertyStr(ctx,o,"denied",JS_NewInt64(ctx,stats.denied));JS_SetPropertyStr(ctx,o,"limit",JS_NewInt64(ctx,REQUESTED_HEAP_LIMIT));return o;
}
static struct origin_report {char begin[32];uint32_t version,state,bytes,truncated,ordinal,reserved;char text[4096];char end[32];} origin={"FORKWAKE_QJS_ORIGIN_BEGIN_V1",1,0,0,0,0,0,{0},"FORKWAKE_QJS_ORIGIN_END_V1"};
_Static_assert(offsetof(struct origin_report,text)==56,"Origin text layout");
_Static_assert(offsetof(struct origin_report,end)==4152,"Origin end layout");
static void origin_clear(void){origin.state=0;origin.bytes=0;origin.truncated=0;origin.ordinal=0;origin.text[0]=0;}
static int valid_utf8(const unsigned char *s,size_t size){for(size_t i=0;i<size;){unsigned char c=s[i++];if(c<0x80)continue;uint32_t v,min;unsigned count;if(c>=0xc2&&c<=0xdf){v=c&31;min=0x80;count=1;}else if(c>=0xe0&&c<=0xef){v=c&15;min=0x800;count=2;}else if(c>=0xf0&&c<=0xf4){v=c&7;min=0x10000;count=3;}else return 0;if(count>size-i)return 0;while(count--){c=s[i++];if((c&0xc0)!=0x80)return 0;v=(v<<6)|(c&63);}if(v<min||v>0x10ffff||(v>=0xd800&&v<=0xdfff))return 0;}return 1;}
static void origin_capture(JSContext *ctx,uint32_t ordinal){
 origin_clear();origin.ordinal=ordinal;origin.state=2;JS_ThrowInternalError(ctx,"Forkwake optional origin");JSValue error=JS_GetException(ctx);JSAtom atom=JS_NewAtom(ctx,"stack");
 if(atom){JSPropertyDescriptor descriptor;int found=JS_GetOwnProperty(ctx,&descriptor,error,atom);JS_FreeAtom(ctx,atom);if(found>0){if(!(descriptor.flags&JS_PROP_GETSET)&&JS_IsString(descriptor.value)){size_t size;const char *text=JS_ToCStringLen(ctx,&size,descriptor.value);if(text){if(size&&valid_utf8((const unsigned char*)text,size)){size_t n=size;if(n>=sizeof(origin.text)){n=sizeof(origin.text)-1;while(n&&((unsigned char)text[n]&0xc0)==0x80)n--;}memcpy(origin.text,text,n);origin.text[n]=0;origin.bytes=n;origin.truncated=size>=sizeof(origin.text);origin.state=1;}JS_FreeCString(ctx,text);}}JS_FreeValue(ctx,descriptor.value);JS_FreeValue(ctx,descriptor.getter);JS_FreeValue(ctx,descriptor.setter);}}
 JS_FreeValue(ctx,error);/* Consume failures from atom/property/string allocation too. */JSValue pending=JS_GetException(ctx);JS_FreeValue(ctx,pending);
}
enum { W_VERSION=0,W_STATUS=1,W_RESULT=2,W_ENTRY=3,W_OUTPUT=4,W_DIAGNOSTIC=5,W_PENDING_KIND=6,W_ORDINAL=7,W_LABEL=8,W_PAYLOAD=9,W_CURRENT=10,W_PEAK=11,W_DENIED=12,W_LIMIT=13,W_INTERRUPTS=14,W_UNHANDLED=15 };
static struct guest_report {
 char marker[32]; uint32_t words[16]; char label[97]; char payload[4097]; char output[16384]; char diagnostic[4096]; char end[32];
} report={"FORKWAKE_QJS_REPORT_BEGIN_V1",{1,0,0,0,0,0,0,0,0,0,0,0,0,REQUESTED_HEAP_LIMIT,0,0},{0},{0},{0},{0},"FORKWAKE_QJS_REPORT_END_V1"};
_Static_assert(offsetof(struct guest_report,words)==32,"word layout");
_Static_assert(offsetof(struct guest_report,label)==96,"label layout");
_Static_assert(offsetof(struct guest_report,payload)==193,"payload layout");
_Static_assert(offsetof(struct guest_report,output)==4290,"output layout");
_Static_assert(offsetof(struct guest_report,diagnostic)==20674,"diagnostic layout");
_Static_assert(offsetof(struct guest_report,end)==24770,"end layout");
#define output report.output
#define output_size report.words[W_OUTPUT]
#define entries report.words[W_ENTRY]
static void sync_stats(void){report.words[W_CURRENT]=stats.current;report.words[W_PEAK]=stats.peak;report.words[W_DENIED]=stats.denied;report.words[W_INTERRUPTS]=stats.interrupt_calls;}
static void diagnostic_text(const char *s,size_t size){size_t n=size;if(n>=sizeof(report.diagnostic)){n=sizeof(report.diagnostic)-1;while(n&&((unsigned char)s[n]&0xc0)==0x80)n--;}memcpy(report.diagnostic,s,n);report.diagnostic[n]=0;report.words[W_DIAGNOSTIC]=n;report.words[W_STATUS]=3;}
static JSValue rejected_promises[64],rejected_reasons[64];static uint32_t rejected_count;
static void rejected(JSContext *ctx,JSValueConst promise,JSValueConst reason,JS_BOOL handled,void *opaque){
 (void)opaque;uint32_t i;for(i=0;i<rejected_count;i++)if(JS_VALUE_GET_PTR(rejected_promises[i])==JS_VALUE_GET_PTR(promise))break;
 if(handled){if(i<rejected_count){JS_FreeValue(ctx,rejected_promises[i]);JS_FreeValue(ctx,rejected_reasons[i]);--rejected_count;rejected_promises[i]=rejected_promises[rejected_count];rejected_reasons[i]=rejected_reasons[rejected_count];}}
 else if(i==rejected_count){if(rejected_count>=64){const char *m="Unhandled promise tracking limit exceeded";diagnostic_text(m,strlen(m));}else{rejected_promises[rejected_count]=JS_DupValue(ctx,promise);rejected_reasons[rejected_count]=JS_DupValue(ctx,reason);++rejected_count;}}
 report.words[W_UNHANDLED]=rejected_count;
}
int gettimeofday(struct timeval *tv, void *tz) { (void)tz; tv->tv_sec = 1700000000; tv->tv_usec = 123456; return 0; }
__wasi_errno_t __wrap___wasi_fd_write(__wasi_fd_t fd, const __wasi_ciovec_t *v, size_t n, __wasi_size_t *written) { (void)fd;(void)v;(void)n; *written=0; return __WASI_ERRNO_BADF; }
__wasi_errno_t __wrap___wasi_fd_close(__wasi_fd_t fd) { (void)fd; return __WASI_ERRNO_BADF; }
__wasi_errno_t __wrap___wasi_fd_seek(__wasi_fd_t fd, __wasi_filedelta_t off, __wasi_whence_t whence, __wasi_filesize_t *out) {(void)fd;(void)off;(void)whence;(void)out;return __WASI_ERRNO_BADF;}
_Noreturn void __wrap___wasi_proc_exit(__wasi_exitcode_t code) { (void)code; __builtin_trap(); }
__wasi_errno_t __wrap___wasi_clock_time_get(__wasi_clockid_t id, __wasi_timestamp_t precision, __wasi_timestamp_t *out) {(void)id;(void)precision;*out=1700000000123456000ULL;return 0;}
static JSValue effect(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
  (void)self; if(argc!=4) return JS_ThrowTypeError(ctx,"effect requires four i32 values");
  int32_t a[4]; for(int i=0;i<4;i++){double v;if(!JS_IsNumber(argv[i])||JS_ToFloat64(ctx,&v,argv[i])||!isfinite(v)||trunc(v)!=v||v<-2147483648.0||v>2147483647.0)return JS_ThrowTypeError(ctx,"effect arguments must be exact signed i32 numbers");a[i]=(int32_t)v;}
  origin_clear();report.words[W_PENDING_KIND]=0;report.words[W_LABEL]=0;report.words[W_PAYLOAD]=0;report.label[0]=0;report.payload[0]=0;++report.words[W_ORDINAL];sync_stats();int32_t answer=pending_effect(a[0],a[1],a[2],a[3]);
  post_cut(a[0],answer); return JS_NewInt32(ctx,answer);
}
static JSValue emit(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv) {
  (void)self; if(argc!=1||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"emit requires exactly one string");
  size_t size;const char *text=JS_ToCStringLen(ctx,&size,argv[0]);if(!text)return JS_EXCEPTION;
  if(size>=sizeof(output)){JS_FreeCString(ctx,text);return JS_ThrowRangeError(ctx,"output full");}
  memcpy(output,text,size);output[size]=0;output_size=size;JS_FreeCString(ctx,text);return JS_UNDEFINED;
}
static uint32_t text_hash(const char *s,size_t n){uint32_t h=2166136261u;for(size_t i=0;i<n;i++){h^=(unsigned char)s[i];h*=16777619u;}return h;}
static JSValue decision(JSContext *ctx,JSValueConst self,int argc,JSValueConst *argv){
 (void)self;if(argc!=2||!JS_IsString(argv[0]))return JS_ThrowTypeError(ctx,"decision requires a string label and JSON-serializable payload");
 size_t label_size;const char *label=JS_ToCStringLen(ctx,&label_size,argv[0]);if(!label)return JS_EXCEPTION;
 if(!label_size||label_size>96||memchr(label,0,label_size)){JS_FreeCString(ctx,label);return JS_ThrowRangeError(ctx,"decision label must be 1 to 96 UTF-8 bytes without NUL");}
 JSValue serialized=JS_JSONStringify(ctx,argv[1],JS_UNDEFINED,JS_UNDEFINED);if(JS_IsException(serialized)){JS_FreeCString(ctx,label);return JS_EXCEPTION;}if(!JS_IsString(serialized)){JS_FreeCString(ctx,label);JS_FreeValue(ctx,serialized);return JS_ThrowTypeError(ctx,"decision payload is not JSON-serializable");}
 size_t payload_size;const char *payload=JS_ToCStringLen(ctx,&payload_size,serialized);if(!payload){JS_FreeCString(ctx,label);JS_FreeValue(ctx,serialized);return JS_EXCEPTION;}
 if(payload_size>4096){JS_FreeCString(ctx,label);JS_FreeCString(ctx,payload);JS_FreeValue(ctx,serialized);return JS_ThrowRangeError(ctx,"decision payload exceeds 4096 UTF-8 JSON bytes");}
 memcpy(report.label,label,label_size);report.label[label_size]=0;memcpy(report.payload,payload,payload_size);report.payload[payload_size]=0;report.words[W_PENDING_KIND]=1;report.words[W_LABEL]=label_size;report.words[W_PAYLOAD]=payload_size;uint32_t ordinal=++report.words[W_ORDINAL];
 uint32_t label_hash=text_hash(label,label_size),payload_hash=text_hash(payload,payload_size);JS_FreeCString(ctx,label);JS_FreeCString(ctx,payload);JS_FreeValue(ctx,serialized);origin_capture(ctx,ordinal);sync_stats();
 int32_t response=pending_effect(ordinal,label_hash,payload_hash,payload_size);post_cut(ordinal,response);return JS_NewInt32(ctx,response);
}
static int fail(JSContext *ctx){JSValue ex=JS_GetException(ctx);size_t size;const char *s=JS_ToCStringLen(ctx,&size,ex);if(s){diagnostic_text(s,size);JS_FreeCString(ctx,s);}else{const char *m="Script exception could not be converted to text";diagnostic_text(m,strlen(m));}JS_FreeValue(ctx,ex);return -997;}
__attribute__((export_name("run"))) int32_t run(int32_t seed) {
  origin_clear();++entries;pre_cut(1,entries);memset(&stats,0,sizeof(stats));output_size=0;output[0]=0;report.words[W_STATUS]=1;report.words[W_RESULT]=0;report.words[W_DIAGNOSTIC]=0;report.diagnostic[0]=0;report.words[W_PENDING_KIND]=0;report.words[W_ORDINAL]=0;report.words[W_LABEL]=0;report.words[W_PAYLOAD]=0;report.label[0]=report.payload[0]=0;report.words[W_UNHANDLED]=0;rejected_count=0;
  int32_t result=-998;JSRuntime *rt=JS_NewRuntime2(&owned_allocators,NULL);if(!rt){const char *m="Could not allocate the JavaScript runtime";diagnostic_text(m,strlen(m));sync_stats();return result;}
  JS_SetHostPromiseRejectionTracker(rt,rejected,NULL);JS_SetMemoryLimit(rt,REQUESTED_HEAP_LIMIT);JS_SetInterruptHandler(rt,interrupt,NULL);JS_SetMaxStackSize(rt,256*1024);
  JSContext *ctx=JS_NewContext(rt);if(!ctx){const char *m="Could not allocate the JavaScript context";diagnostic_text(m,strlen(m));JS_FreeRuntime(rt);sync_stats();return result;}
  JSValue g=JS_GetGlobalObject(ctx);
  JS_SetPropertyStr(ctx,g,"seed",JS_NewInt32(ctx,seed));JS_SetPropertyStr(ctx,g,"heapStats",JS_NewCFunction(ctx,heap_stats,"heapStats",0));
  JS_SetPropertyStr(ctx,g,"effect",JS_NewCFunction(ctx,effect,"effect",4));JS_SetPropertyStr(ctx,g,"decision",JS_NewCFunction(ctx,decision,"decision",2));
  JS_SetPropertyStr(ctx,g,"emit",JS_NewCFunction(ctx,emit,"emit",1));
  size_t source_size=strnlen(script,sizeof(script));if(source_size==sizeof(script)){result=-996;goto cleanup;}
  JSValue value=JS_Eval(ctx,script,source_size,"script.js",JS_EVAL_TYPE_GLOBAL);
  if(JS_IsException(value)){result=fail(ctx);goto cleanup;}JS_FreeValue(ctx,value);
  JSContext *jobctx;int status;while((status=JS_ExecutePendingJob(rt,&jobctx))>0){}if(status<0){result=fail(jobctx);goto cleanup;}
  if(rejected_count){size_t n;const char *reason=JS_ToCStringLen(ctx,&n,rejected_reasons[0]);if(reason){diagnostic_text(reason,n);JS_FreeCString(ctx,reason);}else{const char *m="Unhandled promise rejection";diagnostic_text(m,strlen(m));}result=-997;goto cleanup;}
  if(report.words[W_STATUS]==3){result=-997;goto cleanup;}
  /* Read an explicit own data property, never invoke an accessor after jobs
     finish. Host-triggered getters could enqueue unobserved jobs or effects. */
  JSAtom result_atom=JS_NewAtom(ctx,"resultI32");if(!result_atom){result=fail(ctx);goto cleanup;}
  JSPropertyDescriptor descriptor;int found=JS_GetOwnProperty(ctx,&descriptor,g,result_atom);JS_FreeAtom(ctx,result_atom);
  if(found<0){result=fail(ctx);goto cleanup;}
  if(!found){JS_ThrowTypeError(ctx,"resultI32 must be an explicit own signed i32 data property");result=fail(ctx);goto cleanup;}
  if(descriptor.flags&JS_PROP_GETSET){JS_FreeValue(ctx,descriptor.value);JS_FreeValue(ctx,descriptor.getter);JS_FreeValue(ctx,descriptor.setter);JS_ThrowTypeError(ctx,"resultI32 must be a data property, not a getter or setter");result=fail(ctx);goto cleanup;}
  value=descriptor.value;JS_FreeValue(ctx,descriptor.getter);JS_FreeValue(ctx,descriptor.setter);double number;
  if(!JS_IsNumber(value)||JS_ToFloat64(ctx,&number,value)||!isfinite(number)||trunc(number)!=number||number<-2147483648.0||number>2147483647.0){JS_ThrowTypeError(ctx,"resultI32 must be an explicit signed i32 integer number");result=fail(ctx);JS_FreeValue(ctx,value);goto cleanup;}result=(int32_t)number;JS_FreeValue(ctx,value);report.words[W_RESULT]=(uint32_t)result;report.words[W_STATUS]=2;
cleanup:
  for(uint32_t i=0;i<rejected_count;i++){JS_FreeValue(ctx,rejected_promises[i]);JS_FreeValue(ctx,rejected_reasons[i]);}JS_FreeValue(ctx,g);JS_FreeContext(ctx);JS_FreeRuntime(rt);if(stats.current!=0)__builtin_trap();sync_stats();return result;
}
__attribute__((export_name("header_address"))) uint32_t header_address(void){return (uintptr_t)asyncify_storage;}
__attribute__((export_name("asyncify_capacity"))) uint32_t asyncify_capacity(void){return sizeof(asyncify_storage);}
__attribute__((export_name("output_address"))) uint32_t output_address(void){return (uintptr_t)output;}
__attribute__((export_name("output_length"))) uint32_t output_length(void){return output_size;}
__attribute__((export_name("entry_count"))) uint32_t entry_count(void){return entries;}

__attribute__((export_name("script_address"))) uint32_t script_address(void){return (uintptr_t)source_slot.text;}
__attribute__((export_name("script_capacity"))) uint32_t script_capacity(void){return sizeof(source_slot.text);}
__attribute__((export_name("heap_current"))) uint32_t heap_current(void){return stats.current;}
__attribute__((export_name("heap_peak"))) uint32_t heap_peak(void){return stats.peak;}
__attribute__((export_name("heap_denied"))) uint32_t heap_denied(void){return stats.denied;}
__attribute__((export_name("heap_stats_address"))) uint32_t heap_stats_address(void){return (uintptr_t)&stats;}

/* Scratch-only direct allocator checks. All bytes are still owned guest memory. */
__attribute__((export_name("allocator_selftest"))) uint32_t allocator_selftest(void){
 memset(&stats,0,sizeof(stats));JSMallocState state={0,0,64,NULL};uint32_t passed=0;
 unsigned char *p=owned_malloc(&state,13);if(p&&((uintptr_t)p%_Alignof(max_align_t))==0&&owned_size(p)==13&&stats.current==13&&state.malloc_size==13&&state.malloc_count==1)passed|=1;else __builtin_trap();
 memset(p,0x5a,13);unsigned char *q=owned_realloc(&state,p,29);if(q&&stats.current==29&&state.malloc_size==29&&state.malloc_count==1&&q[0]==0x5a&&q[12]==0x5a)passed|=2;else __builtin_trap();
 p=owned_realloc(&state,q,7);if(p&&stats.current==7&&state.malloc_size==7&&state.malloc_count==1&&p[6]==0x5a)passed|=4;else __builtin_trap();
 q=owned_realloc(&state,p,100);if(!q&&stats.current==7&&state.malloc_size==7&&owned_size(p)==7&&p[6]==0x5a&&stats.denied==1)passed|=8;else __builtin_trap();
 q=owned_malloc(&state,60);if(!q&&stats.current==7&&state.malloc_size==7&&stats.denied==2)passed|=16;else __builtin_trap();
 owned_free(&state,p);owned_free(&state,NULL);if(!stats.current&&!state.malloc_size&&!state.malloc_count&&stats.peak==29)passed|=32;else __builtin_trap();
 p=owned_realloc(&state,NULL,11);if(p&&stats.current==11)passed|=64;else __builtin_trap();
 q=owned_realloc(&state,p,0);if(!q&&!stats.current&&!state.malloc_size&&!state.malloc_count)passed|=128;else __builtin_trap();return passed;
}

__attribute__((export_name("guest_report_address"))) uint32_t guest_report_address(void){return (uintptr_t)report.words;}
/* Build-time constant accessor keeps the complete marked region addressable. */
__attribute__((export_name("origin_report_address"))) uint32_t origin_report_address(void){return (uintptr_t)&origin.version;}
