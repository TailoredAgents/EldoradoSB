import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";

export default async function Home() {
  redirect((await isLoggedIn()) ? "/outreach-today" : "/login");
}
