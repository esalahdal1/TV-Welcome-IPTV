package com.example.tv_guest_welcome.iptv.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.example.tv_guest_welcome.R
import com.example.tv_guest_welcome.iptv.Channel
import com.example.tv_guest_welcome.iptv.ImageLoader
import kotlinx.coroutines.CoroutineScope

class ChannelAdapter(
    private val scope: CoroutineScope,
    private val imageLoader: ImageLoader,
    private val itemWidthDp: Int? = null,
    private val onClick: (Channel, Int) -> Unit
) : RecyclerView.Adapter<ChannelAdapter.VH>() {
    private val items = ArrayList<Channel>()

    fun submit(channels: List<Channel>) {
        items.clear()
        items.addAll(channels)
        notifyDataSetChanged()
    }

    fun getChannels(): List<Channel> = items.toList()

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_channel, parent, false)
        return VH(view)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]
        holder.name.text = item.name
        imageLoader.load(scope, item.logoUrl, holder.logo, android.R.drawable.ic_media_play)
        val lp = holder.root.layoutParams
        if (lp != null) {
            lp.width = itemWidthDp?.let { dp ->
                (dp * holder.root.resources.displayMetrics.density).toInt().coerceAtLeast(1)
            } ?: ViewGroup.LayoutParams.MATCH_PARENT
            holder.root.layoutParams = lp
        }
        holder.root.setOnClickListener { onClick(item, position) }
    }

    override fun getItemCount(): Int = items.size

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val root: View = view
        val logo: ImageView = view.findViewById(R.id.channel_logo)
        val name: TextView = view.findViewById(R.id.channel_name)
    }
}
