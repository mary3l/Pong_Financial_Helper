import { Suspense } from "react";
import { Modal } from "@/components/modal";
import { Afford, AffordSkeleton } from "../../afford/afford";

// Can I afford this? opened from inside the app (the card on Home): shown
// over the current page.
export default function AffordModal() {
  return (
    <Modal path="/afford" label="Can I afford this?">
      <Suspense fallback={<AffordSkeleton mode="modal" />}>
        <Afford mode="modal" />
      </Suspense>
    </Modal>
  );
}
