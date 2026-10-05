<script lang="ts">
  import type { Option } from '#lib/research/form.js';
  let { name, label, options, value, multiple=false, onchange }: {
    name:string; label:string; options:Option[]; value:string|string[]; multiple?:boolean; onchange:(value:string)=>void;
  } = $props();
</script>
<fieldset>
  <legend>{label}</legend>
  <div class="choices">
    {#each options as option}
      <label class:selected={Array.isArray(value)?value.includes(option.value):value===option.value}>
        <input type={multiple?'checkbox':'radio'} {name} value={option.value} checked={Array.isArray(value)?value.includes(option.value):value===option.value} onchange={()=>onchange(option.value)} />
        <span>{option.label}</span>
      </label>
    {/each}
  </div>
</fieldset>
<style>
  fieldset{border:0;padding:0;margin:0;min-width:0}legend{font-size:13px;line-height:1.5;font-weight:600;color:#34556b;margin-bottom:10px;padding:0}
  .choices{display:grid;gap:8px}label{display:flex;align-items:center;gap:13px;padding:13px 15px;min-height:48px;border:1px solid #beced8;border-radius:8px;color:#233f52;background:#fff;cursor:pointer;font-size:14px;line-height:1.45}
  label:hover{border-color:#537f9b;background:#f2f7fa}label.selected{border-color:#315d79;background:#e3eef5;box-shadow:inset 0 0 0 1px #315d79}
  input{width:17px;height:17px;margin:0;flex-shrink:0;accent-color:#214c6b}label:has(input:focus-visible){outline:3px solid #4b93c4;outline-offset:3px}input:focus-visible{outline:none}
  @media(max-width:480px){label{font-size:13px;padding:11px 12px;gap:10px}.choices{gap:7px}}
</style>
