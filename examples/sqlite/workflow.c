#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "sqlite3.h"
__attribute__((import_module("env"),import_name("pre_cut"))) extern void pre_cut(int32_t,uint32_t);
__attribute__((import_module("env"),import_name("pending_effect"))) extern int32_t pending_effect(uint32_t,uint32_t,uint32_t,uint32_t);
__attribute__((import_module("env"),import_name("post_cut"))) extern void post_cut(int32_t,uint32_t);
static uint32_t random_state=0x12345678, forbidden_files, entries;
static sqlite3 *db;
static sqlite3_stmt *cursor;
static sqlite3_stmt *payment;
static uint32_t callback_entries;
static uint32_t *canary;
static uint32_t async_storage[131074];
static uint32_t results[22];
static char database_json[2048];
static int sealed_open(sqlite3_vfs *v,const char *z,sqlite3_file *f,int flags,int *out){(void)v;(void)z;(void)f;(void)flags;(void)out;forbidden_files++;return SQLITE_CANTOPEN;}
static int sealed_delete(sqlite3_vfs*v,const char*z,int sync){(void)v;(void)z;(void)sync;forbidden_files++;return SQLITE_IOERR_DELETE;}
static int sealed_access(sqlite3_vfs*v,const char*z,int flags,int*out){(void)v;(void)z;(void)flags;*out=0;return SQLITE_OK;}
static int sealed_path(sqlite3_vfs*v,const char*z,int n,char*out){(void)v;if((int)strlen(z)>=n)return SQLITE_CANTOPEN;memcpy(out,z,strlen(z)+1);return SQLITE_OK;}
static int sealed_random(sqlite3_vfs*v,int n,char*out){(void)v;for(int i=0;i<n;i++){random_state^=random_state<<13;random_state^=random_state>>17;random_state^=random_state<<5;out[i]=(char)random_state;}return n;}
static int sealed_sleep(sqlite3_vfs*v,int n){(void)v;(void)n;return 0;}
static int sealed_time(sqlite3_vfs*v,double*out){(void)v;*out=2451545.0;return SQLITE_OK;}
static sqlite3_vfs vfs={.iVersion=1,.szOsFile=sizeof(sqlite3_file),.mxPathname=128,.zName="sealed-memory",
 .xOpen=sealed_open,.xDelete=sealed_delete,.xAccess=sealed_access,.xFullPathname=sealed_path,
 .xRandomness=sealed_random,.xSleep=sealed_sleep,.xCurrentTime=sealed_time};
int sqlite3_os_init(void){return sqlite3_vfs_register(&vfs,1);}
int sqlite3_os_end(void){return SQLITE_OK;}
static void ok(int code){if(code!=SQLITE_OK)__builtin_trap();}
static void sql(const char*text){ok(sqlite3_exec(db,text,0,0,0));}
static uint32_t scalar(const char*text){sqlite3_stmt*s;ok(sqlite3_prepare_v2(db,text,-1,&s,0));if(sqlite3_step(s)!=SQLITE_ROW)__builtin_trap();uint32_t r=(uint32_t)sqlite3_column_int(s,0);ok(sqlite3_finalize(s));return r;}
__attribute__((noinline)) static void payment_function(sqlite3_context *context,int argc,sqlite3_value **arguments){
 if(argc!=2)__builtin_trap();
 uint32_t quantity=(uint32_t)sqlite3_value_int64(arguments[0]);
 uint32_t live_local=(uint32_t)sqlite3_value_int64(arguments[1])^0x10203040u;
 callback_entries++;
 results[20]=(uint32_t)sqlite3_stmt_busy(payment);results[21]=(uint32_t)sqlite3_get_autocommit(db);
 pre_cut(4,callback_entries);
 int response=pending_effect(801,quantity,(uint32_t)(uintptr_t)db,(uint32_t)(uintptr_t)cursor);
 results[18]=live_local;results[19]=callback_entries;
 sqlite3_result_int(context,response);
 post_cut(4,live_local);
}
__attribute__((noinline)) static uint32_t authorize(uint32_t quantity,uint32_t saved_local){
 volatile uint32_t local[3]={quantity*31+17,saved_local^0x2468ace0u,0};local[2]=local[0]+local[1];
 pre_cut(3,local[2]);
 ok(sqlite3_prepare_v2(db,"SELECT authorize_payment(?1,?2)",-1,&payment,0));
 ok(sqlite3_bind_int64(payment,1,quantity));ok(sqlite3_bind_int64(payment,2,local[2]));
 if(sqlite3_step(payment)!=SQLITE_ROW)__builtin_trap();
 int response=sqlite3_column_int(payment,0);ok(sqlite3_finalize(payment));payment=0;
 results[0]=(uint32_t)response;
 results[1]=(uint32_t)sqlite3_get_autocommit(db);
 results[2]=(uint32_t)sqlite3_stmt_busy(cursor);
 if(response==1){sql("UPDATE orders SET status='paid' WHERE id=3; INSERT INTO receipts VALUES(3,120,'paid'); COMMIT;");}
 else {sql("ROLLBACK;");if(response==0)sql("INSERT INTO attempts VALUES('denied');");else sql("INSERT INTO attempts VALUES('timeout');");}
 uint32_t sum=1,count=1;
 int status;
 while((status=sqlite3_step(cursor))==SQLITE_ROW){sum+=(uint32_t)sqlite3_column_int(cursor,0);count++;}
 if(status!=SQLITE_DONE)__builtin_trap();
 results[3]=sum;results[4]=count;ok(sqlite3_finalize(cursor));cursor=0;
 results[5]=scalar("SELECT count(*) FROM orders");results[6]=scalar("SELECT count(*) FROM receipts");
 results[7]=scalar("SELECT count(*) FROM temp.staging");results[8]=scalar("SELECT count(*) FROM attempts");
 results[9]=(uint32_t)sqlite3_get_autocommit(db);
 uint32_t checksum=0;for(uint32_t i=0;i<16384;i++)checksum=checksum*33u+canary[i];
 results[10]=checksum;results[11]=local[0]^local[1]^saved_local;
 canary[123]^=(uint32_t)response;results[12]=canary[123];
 results[13]=scalar("SELECT coalesce(sum(total),0) FROM receipts");
 results[14]=forbidden_files;results[15]=(uint32_t)sqlite3_memory_used();
 results[16]=scalar("SELECT count(*) FROM attempts WHERE status='denied'");
 results[17]=scalar("SELECT count(*) FROM attempts WHERE status='timeout'");
 sqlite3_stmt *dump;
 ok(sqlite3_prepare_v2(db,"SELECT json_object('orders',json((SELECT json_group_array(json_object('id',id,'total',total,'status',status)) FROM orders)),'receipts',json((SELECT json_group_array(json_object('id',id,'total',total,'status',status)) FROM receipts)),'attempts',json((SELECT json_group_array(status) FROM attempts)),'staging',json((SELECT json_group_array(json_object('id',id,'total',total)) FROM temp.staging)))",-1,&dump,0));
 if(sqlite3_step(dump)!=SQLITE_ROW)__builtin_trap();
 int bytes=sqlite3_column_bytes(dump,0);if(bytes<0||bytes>=(int)sizeof(database_json))__builtin_trap();
 memcpy(database_json,sqlite3_column_text(dump,0),(size_t)bytes);database_json[bytes]=0;ok(sqlite3_finalize(dump));
 post_cut(3,results[13]);return results[11]+sum+count;
}
__attribute__((noinline)) static uint32_t checkout(uint32_t quantity){
 uint32_t live=quantity*13+29;sql("BEGIN IMMEDIATE; INSERT INTO orders VALUES(3,120,'pending'); INSERT INTO temp.staging VALUES(3,120);");
 ok(sqlite3_prepare_v2(db,"SELECT id,total FROM orders ORDER BY id",-1,&cursor,0));
 if(sqlite3_step(cursor)!=SQLITE_ROW||sqlite3_column_int(cursor,0)!=1)__builtin_trap();
 pre_cut(2,(uint32_t)(uintptr_t)cursor);uint32_t nested=authorize(quantity,live);post_cut(2,nested);return nested+live;
}
__attribute__((export_name("run"),noinline)) uint32_t run(uint32_t quantity){
 entries++;ok(sqlite3_open_v2(":memory:",&db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE,"sealed-memory"));
 ok(sqlite3_create_function_v2(db,"authorize_payment",2,SQLITE_UTF8,0,payment_function,0,0,0));
 sql("PRAGMA temp_store=MEMORY; PRAGMA journal_mode=MEMORY; CREATE TABLE orders(id INTEGER PRIMARY KEY,total INTEGER,status TEXT); INSERT INTO orders VALUES(1,15,'old'),(2,27,'old'); CREATE TABLE receipts(id INTEGER,total INTEGER,status TEXT); CREATE TABLE attempts(status TEXT); CREATE TEMP TABLE staging(id INTEGER,total INTEGER);");
 canary=malloc(65536);if(!canary)__builtin_trap();for(uint32_t i=0;i<16384;i++)canary[i]=quantity*17+i*97;
 pre_cut(1,entries);uint32_t root_local=quantity*19+7;uint32_t result=checkout(quantity);post_cut(1,result+root_local);return result+root_local;
}
__attribute__((export_name("header_address"))) uint32_t header(void){return(uint32_t)(uintptr_t)async_storage;}
__attribute__((export_name("asyncify_capacity"))) uint32_t capacity(void){return sizeof(async_storage);}
__attribute__((export_name("results_address"))) uint32_t result_address(void){return(uint32_t)(uintptr_t)results;}
__attribute__((export_name("canary_address"))) uint32_t canary_address(void){return(uint32_t)(uintptr_t)canary;}
__attribute__((export_name("entry_count"))) uint32_t entry_count(void){return entries;}
__attribute__((export_name("file_count"))) uint32_t file_count(void){return forbidden_files;}
__attribute__((export_name("database_address"))) uint32_t database_address(void){return(uint32_t)(uintptr_t)db;}
__attribute__((export_name("cursor_address"))) uint32_t cursor_address(void){return(uint32_t)(uintptr_t)cursor;}
__attribute__((export_name("database_json_address"))) uint32_t json_address(void){return(uint32_t)(uintptr_t)database_json;}
__attribute__((export_name("payment_address"))) uint32_t payment_address(void){return(uint32_t)(uintptr_t)payment;}
