CREATE POLICY "users can see their assigned actions" ON public.action_items FOR SELECT TO authenticated USING (
  assignee ILIKE '%' || (SELECT full_name FROM public.profiles WHERE id = auth.uid()) || '%'
  OR 
  assignee ILIKE '%' || split_part(auth.jwt() ->> 'email', '@', 1) || '%'
);

CREATE POLICY "users can update their assigned actions" ON public.action_items FOR UPDATE TO authenticated USING (
  assignee ILIKE '%' || (SELECT full_name FROM public.profiles WHERE id = auth.uid()) || '%'
  OR 
  assignee ILIKE '%' || split_part(auth.jwt() ->> 'email', '@', 1) || '%'
);
