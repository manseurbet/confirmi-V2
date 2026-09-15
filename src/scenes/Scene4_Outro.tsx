import React from 'react';
import { motion } from 'framer-motion';

export default function Scene4_Outro() {
  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f172a]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
    >
      <motion.div
        className="absolute inset-0 bg-[#22c55e]"
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 1, ease: [0.76, 0, 0.24, 1], originY: 1 }}
      />
      
      <div className="relative z-10 text-center">
        <motion.h1 
          className="text-5xl md:text-8xl font-arabic font-bold text-white mb-6 leading-tight"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.8 }}
        >
          لا تسلّم قبل ما تتأكد
        </motion.h1>
        
        <motion.h2
          className="text-3xl md:text-5xl font-bold text-[#0f172a]"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.0, duration: 0.8 }}
        >
          Confirme avant de livrer.
        </motion.h2>

        <motion.div 
          className="mt-16 flex items-center justify-center gap-4"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 3.0, type: "spring", stiffness: 200 }}
        >
          <div className="w-16 h-16 bg-[#0f172a] rounded-2xl flex items-center justify-center">
            <span className="text-[#22c55e] font-bold text-2xl">C</span>
          </div>
          <span className="text-4xl font-bold text-[#0f172a] tracking-tight">Confirmi</span>
        </motion.div>
      </div>
    </motion.div>
  );
}