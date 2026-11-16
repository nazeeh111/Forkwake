import binaryen from 'binaryen';
export function tinyModule(){const m=binaryen.parseText(`(module
(import "env" "pre_cut" (func $pre (param i32 i32)))
(import "env" "pending_effect" (func $effect (param i32 i32 i32 i32) (result i32)))
(import "env" "post_cut" (func $post (param i32 i32)))
(memory (export "memory") 1 1)
(func (export "header_address") (result i32) (i32.const 1024))
(func (export "asyncify_capacity") (result i32) (i32.const 256))
(func (export "run") (param $input i32) (result i32) (local $a i32) (local $b i32)
(call $pre (i32.const 1) (local.get $input))
(local.set $a (call $effect (i32.const 9) (i32.const 8) (i32.const 7) (i32.const 6)))
(call $post (i32.const 1) (local.get $a))
(local.set $b (call $effect (i32.const 9) (i32.const 8) (i32.const 7) (i32.const 6)))
(call $post (i32.const 2) (local.get $b))
(i32.add (local.get $input) (i32.add (local.get $a) (local.get $b)))))`);try{return Buffer.from(m.emitBinary());}finally{m.dispose();}}
