#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "sqlite3.h"
__attribute__((import_module("env"),import_name("pre_cut"))) extern void pre_cut(int32_t,uint32_t);
__attribute__((import_module("env"),import_name("pending_effect"))) extern int32_t pending_effect(uint32_t,uint32_t,uint32_t,uint32_t);
__attribute__((import_module("env"),import_name("post_cut"))) extern void post_cut(int32_t,uint32_t);
static uint32_t random_state=0x12345678, forbidden_files, entries, callback_entries;
static sqlite3 *db;
static sqlite3_stmt *cursor, *decision_statement;
static uint32_t *canary;
static uint32_t async_storage[131074], results[32];
static char database_json[8192];
static int sealed_open(sqlite3_vfs*v,const char*z,sqlite3_file*f,int flags,int*out){(void)v;(void)z;(void)f;(void)flags;(void)out;forbidden_files++;return SQLITE_CANTOPEN;}
static int sealed_delete(sqlite3_vfs*v,const char*z,int sync){(void)v;(void)z;(void)sync;forbidden_files++;return SQLITE_IOERR_DELETE;}
static int sealed_access(sqlite3_vfs*v,const char*z,int flags,int*out){(void)v;(void)z;(void)flags;*out=0;return SQLITE_OK;}
static int sealed_path(sqlite3_vfs*v,const char*z,int n,char*out){(void)v;if((int)strlen(z)>=n)return SQLITE_CANTOPEN;memcpy(out,z,strlen(z)+1);return SQLITE_OK;}
static int sealed_random(sqlite3_vfs*v,int n,char*out){(void)v;for(int i=0;i<n;i++){random_state^=random_state<<13;random_state^=random_state>>17;random_state^=random_state<<5;out[i]=(char)random_state;}return n;}
static int sealed_sleep(sqlite3_vfs*v,int n){(void)v;(void)n;return 0;}
static int sealed_time(sqlite3_vfs*v,double*out){(void)v;*out=2451545.0;return SQLITE_OK;}
static sqlite3_vfs vfs={.iVersion=1,.szOsFile=sizeof(sqlite3_file),.mxPathname=128,.zName="sealed-memory",.xOpen=sealed_open,.xDelete=sealed_delete,.xAccess=sealed_access,.xFullPathname=sealed_path,.xRandomness=sealed_random,.xSleep=sealed_sleep,.xCurrentTime=sealed_time};
int sqlite3_os_init(void){return sqlite3_vfs_register(&vfs,1);}
int sqlite3_os_end(void){return SQLITE_OK;}
static void ok(int code){if(code!=SQLITE_OK)__builtin_trap();}
static void sql(const char*text){ok(sqlite3_exec(db,text,0,0,0));}
static uint32_t scalar(const char*text){sqlite3_stmt*s;ok(sqlite3_prepare_v2(db,text,-1,&s,0));if(sqlite3_step(s)!=SQLITE_ROW)__builtin_trap();uint32_t r=(uint32_t)sqlite3_column_int(s,0);ok(sqlite3_finalize(s));return r;}
static void dump(void){
 sqlite3_stmt*s;
 ok(sqlite3_prepare_v2(db,"SELECT json_object('orders',json((SELECT json_group_array(json_object('id',id,'quantity',quantity,'status',status)) FROM (SELECT * FROM orders ORDER BY id))),'receipts',json((SELECT json_group_array(json_object('orderId',order_id,'total',total)) FROM (SELECT * FROM receipts ORDER BY order_id))),'shipments',json((SELECT json_group_array(json_object('orderId',order_id,'status',status)) FROM (SELECT * FROM shipments ORDER BY order_id))),'inventory',json((SELECT json_group_array(json_object('sku',sku,'stock',stock,'reserved',reserved)) FROM inventory)),'attempts',json((SELECT json_group_array(json_object('sequence',sequence,'effect',effect,'response',response)) FROM (SELECT * FROM attempts ORDER BY sequence))))",-1,&s,0));
 if(sqlite3_step(s)!=SQLITE_ROW)__builtin_trap();int bytes=sqlite3_column_bytes(s,0);
 if(bytes<0||bytes>=(int)sizeof(database_json))__builtin_trap();memcpy(database_json,sqlite3_column_text(s,0),(size_t)bytes);database_json[bytes]=0;ok(sqlite3_finalize(s));
}
__attribute__((noinline)) static void decision_function(sqlite3_context*context,int argc,sqlite3_value**args){
 if(argc!=3)__builtin_trap();uint32_t effect=(uint32_t)sqlite3_value_int(args[0]),quantity=(uint32_t)sqlite3_value_int(args[1]);
 volatile uint32_t live[3]={(uint32_t)sqlite3_value_int64(args[2]),effect^0x19283746u,quantity*31u+17u};
 callback_entries++;results[0]=effect;results[1]=callback_entries;results[26]=callback_entries;results[2]=(uint32_t)sqlite3_get_autocommit(db);
 results[3]=(uint32_t)sqlite3_stmt_busy(cursor);results[4]=(uint32_t)sqlite3_stmt_busy(decision_statement);results[5]=live[0]^live[1]^live[2];
 results[6]=(uint32_t)sqlite3_memory_used();results[7]=forbidden_files;dump();
 if(callback_entries==1)pre_cut(4,callback_entries);
 int response=pending_effect(effect,quantity,(uint32_t)(uintptr_t)db,(uint32_t)(uintptr_t)cursor);
 results[8]=(uint32_t)response;results[9]=live[0]^live[1]^live[2];
 sqlite3_result_int(context,response);post_cut((int32_t)effect,results[9]);
}
__attribute__((noinline)) static int decide(uint32_t effect,uint32_t quantity,uint32_t saved){
 volatile uint32_t local[3]={quantity*73u+29u,saved^0x2468ace0u,effect};
 if(callback_entries==0)pre_cut(3,local[0]^local[1]^local[2]);
 ok(sqlite3_prepare_v2(db,"SELECT fulfillment_decision(?1,?2,?3)",-1,&decision_statement,0));
 ok(sqlite3_bind_int(decision_statement,1,(int)effect));ok(sqlite3_bind_int(decision_statement,2,(int)quantity));ok(sqlite3_bind_int64(decision_statement,3,local[0]^local[1]^local[2]));
 if(sqlite3_step(decision_statement)!=SQLITE_ROW)__builtin_trap();int response=sqlite3_column_int(decision_statement,0);ok(sqlite3_finalize(decision_statement));decision_statement=0;
 sqlite3_stmt*s;ok(sqlite3_prepare_v2(db,"INSERT INTO attempts(sequence,effect,response) VALUES(?1,?2,?3)",-1,&s,0));
 ok(sqlite3_bind_int(s,1,(int)callback_entries));ok(sqlite3_bind_int(s,2,(int)effect));ok(sqlite3_bind_int(s,3,response));if(sqlite3_step(s)!=SQLITE_DONE)__builtin_trap();ok(sqlite3_finalize(s));
 results[10]^=local[0]^local[1]^local[2];post_cut(5,results[10]);return response;
}
static void status(const char*value){sqlite3_stmt*s;ok(sqlite3_prepare_v2(db,"UPDATE orders SET status=?1 WHERE id=3",-1,&s,0));ok(sqlite3_bind_text(s,1,value,-1,SQLITE_STATIC));if(sqlite3_step(s)!=SQLITE_DONE)__builtin_trap();ok(sqlite3_finalize(s));}
static void release_inventory(void){sql("UPDATE inventory SET reserved=0;");}
static void receipt(uint32_t quantity){sqlite3_stmt*s;ok(sqlite3_prepare_v2(db,"INSERT INTO receipts VALUES(3,?1)",-1,&s,0));ok(sqlite3_bind_int(s,1,(int)(quantity*30u)));if(sqlite3_step(s)!=SQLITE_DONE)__builtin_trap();ok(sqlite3_finalize(s));}
__attribute__((noinline)) static uint32_t fulfill(uint32_t quantity,uint32_t corrected,uint32_t saved){
 volatile uint32_t live[2]={quantity*13u+29u,saved^0x10203040u};
 sql("BEGIN IMMEDIATE;");sqlite3_stmt*s;ok(sqlite3_prepare_v2(db,"INSERT INTO orders VALUES(3,?1,'pending')",-1,&s,0));ok(sqlite3_bind_int(s,1,(int)quantity));if(sqlite3_step(s)!=SQLITE_DONE)__builtin_trap();ok(sqlite3_finalize(s));
 ok(sqlite3_prepare_v2(db,"SELECT id,value FROM catalog ORDER BY id",-1,&cursor,0));if(sqlite3_step(cursor)!=SQLITE_ROW||sqlite3_column_int(cursor,0)!=1)__builtin_trap();pre_cut(2,(uint32_t)(uintptr_t)cursor);
 int reserve=decide(901,quantity,live[0]^live[1]);results[11]=(uint32_t)reserve;
 if(reserve!=1){status(reserve==0?"reservation-denied":"reservation-timeout");goto finish;}
 if(quantity>scalar("SELECT stock FROM inventory")){status("out-of-stock");goto finish;}
 ok(sqlite3_prepare_v2(db,"UPDATE inventory SET reserved=?1",-1,&s,0));ok(sqlite3_bind_int(s,1,(int)quantity));if(sqlite3_step(s)!=SQLITE_DONE)__builtin_trap();ok(sqlite3_finalize(s));status("reserved");
 int payment=decide(902,quantity,live[0]+live[1]);results[12]=(uint32_t)payment;
 if(payment==-1){status("retrying-payment");payment=decide(904,quantity,live[0]-live[1]);results[13]=(uint32_t)payment;}
 if(payment==1){receipt(quantity);status("paid");}
 else if(payment==-1&&!corrected){/* Deliberate owned-example defect: an exhausted timeout is wrongly treated as authorization. */status("assumed-paid");}
 else{status(payment==0?"payment-denied":"payment-timeout");release_inventory();goto finish;}
 int dispatch=decide(903,quantity,live[0]*3u+live[1]);results[14]=(uint32_t)dispatch;
 if(dispatch==1){sql("INSERT INTO shipments VALUES(3,'shipped'); UPDATE orders SET status='shipped' WHERE id=3; UPDATE inventory SET stock=stock-reserved,reserved=0;");}
 else{status(dispatch==0?"dispatch-denied":"dispatch-timeout");release_inventory();}
 finish:
 sql("COMMIT;");uint32_t sum=1,count=1;int step;while((step=sqlite3_step(cursor))==SQLITE_ROW){sum+=(uint32_t)sqlite3_column_int(cursor,0);count++;}if(step!=SQLITE_DONE)__builtin_trap();ok(sqlite3_finalize(cursor));cursor=0;
 results[15]=scalar("SELECT count(*) FROM shipments s LEFT JOIN receipts r ON r.order_id=s.order_id WHERE s.status='shipped' AND r.order_id IS NULL");
 results[16]=scalar("SELECT count(*) FROM receipts");results[17]=scalar("SELECT count(*) FROM shipments");results[18]=scalar("SELECT count(*) FROM attempts");results[19]=scalar("SELECT stock FROM inventory");results[20]=scalar("SELECT reserved FROM inventory");
 results[21]=(uint32_t)sqlite3_get_autocommit(db);results[22]=sum;results[23]=count;results[24]=live[0]^live[1];results[25]=entries;results[26]=callback_entries;
 uint32_t checksum=0;for(uint32_t i=0;i<16384;i++)checksum=checksum*33u+canary[i];results[27]=checksum;canary[123]^=callback_entries;results[28]=canary[123];results[29]=forbidden_files;results[30]=(uint32_t)sqlite3_memory_used();results[31]=corrected;
 dump();post_cut(2,results[15]);return results[15]?1u:0u;
}
__attribute__((export_name("run"),noinline)) uint32_t run(int32_t input){
 if(input==0||input==INT32_MIN)__builtin_trap();uint32_t corrected=input<0,quantity=(uint32_t)(input<0?-input:input);if(quantity>1000000u)__builtin_trap();entries++;results[25]=entries;results[31]=corrected;
 ok(sqlite3_open_v2(":memory:",&db,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE,"sealed-memory"));ok(sqlite3_create_function_v2(db,"fulfillment_decision",3,SQLITE_UTF8,0,decision_function,0,0,0));
 sql("PRAGMA temp_store=MEMORY; PRAGMA journal_mode=MEMORY; CREATE TABLE orders(id INTEGER PRIMARY KEY,quantity INTEGER,status TEXT); CREATE TABLE receipts(order_id INTEGER PRIMARY KEY,total INTEGER); CREATE TABLE shipments(order_id INTEGER PRIMARY KEY,status TEXT); CREATE TABLE inventory(sku TEXT PRIMARY KEY,stock INTEGER,reserved INTEGER); INSERT INTO inventory VALUES('widget',12,0); CREATE TABLE attempts(sequence INTEGER PRIMARY KEY,effect INTEGER,response INTEGER); CREATE TABLE catalog(id INTEGER PRIMARY KEY,value INTEGER); INSERT INTO catalog VALUES(1,17),(2,29),(3,43);");
 canary=malloc(65536);if(!canary)__builtin_trap();for(uint32_t i=0;i<16384;i++)canary[i]=quantity*17u+i*97u;
 pre_cut(1,entries);uint32_t root=quantity*19u+7u;uint32_t result=fulfill(quantity,corrected,root);post_cut(1,result);return result;
}
__attribute__((export_name("header_address"))) uint32_t header(void){return(uint32_t)(uintptr_t)async_storage;}
__attribute__((export_name("asyncify_capacity"))) uint32_t capacity(void){return sizeof(async_storage);}
__attribute__((export_name("results_address"))) uint32_t result_address(void){return(uint32_t)(uintptr_t)results;}
__attribute__((export_name("database_json_address"))) uint32_t json_address(void){return(uint32_t)(uintptr_t)database_json;}
__attribute__((export_name("canary_address"))) uint32_t canary_address(void){return(uint32_t)(uintptr_t)canary;}
__attribute__((export_name("entry_count"))) uint32_t entry_count(void){return entries;}
__attribute__((export_name("database_address"))) uint32_t database_address(void){return(uint32_t)(uintptr_t)db;}
__attribute__((export_name("cursor_address"))) uint32_t cursor_address(void){return(uint32_t)(uintptr_t)cursor;}
__attribute__((export_name("payment_address"))) uint32_t payment_address(void){return(uint32_t)(uintptr_t)decision_statement;}
