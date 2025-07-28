import config from "@/config";
import React from "react";

export default function Footer() {
  return (
    <footer className="w-full py-6 text-center text-sm text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 mt-12">
      © {new Date().getFullYear()} {config.metadata.name} · Powered by {config.owner.name}
    </footer>
  );
}