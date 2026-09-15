import React from 'react';
import { motion } from 'framer-motion';
import { Link, MessageCircle, FileCheck2, Truck } from 'lucide-react';

export default function Scene2_Flow() {
  const steps = [
    { icon: Link, title: "1. Créez un lien", desc: "Générez un lien unique", delay: 0.5 },
    { icon: MessageCircle, title: "2. Envoyez-le", desc: "Via WhatsApp ou SMS", delay: 2.0 },
    { icon: FileCheck2, title: "3. Client confirme", desc: "Avec preuve de paiement", delay: 3.5 },
    { icon: Truck, title: "4. Livrez !", desc: "Expédition 100% sécurisée", delay: 5.0 },
  ];

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center px-10"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.8, ease: "anticipate" }}
    >
      <motion.h2 
        className="text-4xl font-bold mb-16 text-center text-white"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        Comment ça marche ?
      </motion.h2>

      <div className="flex flex-col md:flex-row gap-8 w-full max-w-6xl justify-center items-center">
        {steps.map((step, i) => (
          <React.Fragment key={i}>
            <motion.div 
              className="flex flex-col items-center text-center w-48 relative z-10"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: step.delay, duration: 0.6 }}
            >
              <div className="w-24 h-24 bg-[#1e293b] rounded-2xl border-2 border-[#22c55e] flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(34,197,94,0.2)]">
                <step.icon size={40} className="text-[#22c55e]" />
              </div>
              <h3 className="text-xl font-bold mb-2">{step.title}</h3>
              <p className="text-sm text-slate-400">{step.desc}</p>
            </motion.div>

            {i < steps.length - 1 && (
              <motion.div 
                className="hidden md:block w-16 h-1 bg-slate-700 relative -top-8"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: step.delay + 1, duration: 0.4 }}
                style={{ originX: 0 }}
              >
                <motion.div 
                  className="absolute inset-0 bg-[#22c55e]"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ delay: step.delay + 1.2, duration: 0.4 }}
                  style={{ originX: 0 }}
                />
              </motion.div>
            )}
          </React.Fragment>
        ))}
      </div>
    </motion.div>
  );
}