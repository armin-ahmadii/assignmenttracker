-- Nothing signs in, so only the public (anon) role needs the sync functions.
revoke execute on function
  public.due_claim(text),
  public.due_check(text),
  public.due_push(text, text, jsonb),
  public.due_pull(text, text, timestamptz, integer)
  from authenticated;
