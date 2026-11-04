# New Home App playtest

Run these steps strictly top to bottom. Mapping: **A** Queen + desk, **B** King conflict, **C**
Queen + desk + baby bed, **D** app-owned manual adjustment, **E** King controlled failure.

1. **Action:** Launch `npm start`.
   **Expected:** The title is New Home App and the verified built-in bedroom is already active.
   **Stop if:** A setup/intake screen appears, the room is absent, or the product title differs.

2. **Action:** Load or prepare the local layout model.
   **Expected:** Runtime identifies `qwen3-0.6b-generic-gpu:2` and WebGPU; no external endpoint is used.
   **Stop if:** Another model/provider is selected or preparation fails.

3. **Action (A):** Select **Run next: A · Queen + desk**.
   **Expected:** Queen + rotated standard desk is accepted; Buyer request appears once; Application
   evidence is conclusion-only.
   **Stop if:** The request is duplicated or the accepted layout differs.

4. **Action (B):** Select **Run next: B · King conflict**.
   **Expected:** A King rejected preview appears automatically with **Rejected preview · not
   accepted**; A remains the accepted state; rejected furniture is not interactive.
   **Stop if:** The accepted layout is replaced, another inference is required to see rejection, or
   rejected furniture can be focused/dragged.

5. **Action:** Select **Show accepted layout**, then **Inspect rejected option**.
   **Expected:** A and the same B evidence alternate without changing state version or message count.
   **Stop if:** A new Buyer/Application message appears or inference progress starts.

6. **Action (C):** Select **Run next: C · Queen + desk + baby bed**.
   **Expected:** Queen + compact desk + baby bed is accepted and E becomes the next scripted turn.
   **Stop if:** An extra story branch appears or any locked check changes.

7. **Action (D):** Focus the Queen bed and press Right Arrow once; select **Revert**.
   **Expected:** A 50 mm valid preview appears; Revert restores the original position.
   **Stop if:** Movement differs from 50 mm, inference starts, or Revert changes accepted state.

8. **Action (D):** Drag the compact desk 50 mm; select **Apply**.
   **Expected:** A valid app-owned preview becomes a new accepted manual layout; no Buyer/model turn
   is added.
   **Stop if:** Apply is disabled for the valid preview or a model request appears.

9. **Action (D):** Drag the baby bed 50 mm; select **Revert**.
   **Expected:** The preview is valid and Revert preserves the accepted manual layout.
   **Stop if:** The baby bed is not interactive or another item's coordinates change.

10. **Action (E):** Select **Run next: E · King controlled failure**.
    **Expected:** A King rejected preview appears automatically; C/D remains accepted; rejected
    furniture is non-interactive.
    **Stop if:** The preserved accepted layout changes or the rejected option can be applied.

11. **Action:** Select **Show accepted layout**, then **Inspect rejected option**.
    **Expected:** Existing C/D and E evidence alternate with no inference and no message/state change.
    **Stop if:** Progress starts or evidence differs from the original E result.

12. **Action:** Start recording, then select **Reset**.
    **Expected:** Recording stops, stream ownership is released, prompt/transcript/suggestions/manual
    state clear, State v0 returns, and the built-in room remains active.
    **Stop if:** Audio continues, stale results reappear, or the room is lost.

13. **Action:** Start a fresh recording after Reset, then stop it.
    **Expected:** A new lease succeeds and the editable transcript remains unsent until **Send**.
    **Stop if:** The old stream is reused or the transcript auto-submits.
