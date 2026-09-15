import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';

export default function Scene1_Solution() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#22c55e]"
      initial={{ clipPath: "circle(0% at 50% 50%)" }}
      animate={{ clipPath: "circle(150% at 50% 50%)" }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 1, ease: [0.76, 0, 0.24, 1] }}
    >
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ delay: 0.5, type: "spring", stiffness: 200, damping: 20 }}
        className="bg-white p-6 rounded-full shadow-2xl mb-8"
      >
        <CheckCircle2 size={100} className="text-[#22c55e]" />
      </motion.div>

      <motion.h1
        className="text-7xl md:text-9xl font-extrabold text-white tracking-tighter"
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
      >
        Confirmi
      </motion.h1>

      <motion.p
        className="text-2xl md:text-4xl text-green-100 mt-4 font-semibold"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.6 }}
      >
        La solution pour sécuriser vos envois.
      </motion.p>
    </motion.div>
  );
}